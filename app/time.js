// Pure helpers for Bangkok time (UTC+7, no DST) and booking logic.
const OFFSET_MS = 7 * 60 * 60 * 1000;

export const pad = (n) => String(n).padStart(2, '0');
export const t2m = (s) => { const [h, m] = s.slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const m2t = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;

export function bkkParts(ms) {
  const iso = new Date(ms + OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const crossesMidnight = (s) => t2m(s.close_time) < t2m(s.open_time);

// Same rule as public.night_of() in the database.
export function nightOf(ms, s) {
  const p = bkkParts(ms);
  return crossesMidnight(s) && t2m(p.hhmm) < t2m(s.close_time) ? addDays(p.date, -1) : p.date;
}

export function nightTimeToMs(night, hhmm, s) {
  const date = crossesMidnight(s) && t2m(hhmm) < t2m(s.close_time) ? addDays(night, 1) : night;
  return Date.parse(`${date}T${hhmm}:00+07:00`);
}

// Time choices from opening to closing.
export function slots(s, step = 15) {
  const open = t2m(s.open_time);
  let close = t2m(s.close_time);
  if (close <= open) close += 1440;
  const out = [];
  for (let m = open; m < close; m += step) out.push(m2t(m));
  return out;
}

export const startMs = (b) => Date.parse(b.start_at);
export const endMs = (b) => startMs(b) + b.duration_min * 60000;
export const isActive = (b) => b.status === 'booked' || b.status === 'seated';
// A booking can hold more than one table (combined tables).
export const tablesOf = (b) => [b.table_id, ...(b.extra_table_ids ?? [])];
const holds = (b, tableId) => b.table_id === tableId || (b.extra_table_ids ?? []).includes(tableId);

// wholeNight: a booking holds its table for the whole night, so any active booking on the same table clashes.
export function conflictsFor(draft, bookings, { wholeNight = false } = {}) {
  const mine = tablesOf(draft);
  return bookings.filter((b) =>
    b.id !== draft.id && isActive(b) && tablesOf(b).some((id) => mine.includes(id)) &&
    (wholeNight || (startMs(draft) < endMs(b) && startMs(b) < endMs(draft))));
}

// Whole-night mode: the booking lasts until closing time.
export function minutesToClose(night, startIso, s) {
  let close = nightTimeToMs(night, s.close_time.slice(0, 5), s);
  if (close <= Date.parse(startIso)) close += 86400000;
  return Math.max(15, Math.min(720, Math.round((close - Date.parse(startIso)) / 60000)));
}

// What a table looks like at a moment: seated holds the table until marked done.
// wholeNight: a booked table shows as booked all night, not only from its start time.
export function tableStateAt(tableId, bookings, ms, { wholeNight = false } = {}) {
  const mine = bookings.filter((b) => holds(b, tableId) && isActive(b));
  const seated = mine.find((b) => b.status === 'seated' && (wholeNight || startMs(b) <= ms));
  if (seated) return { state: 'seated', booking: seated };
  const booked = mine.find((b) => b.status === 'booked' && (wholeNight || (startMs(b) <= ms && ms < endMs(b))));
  if (booked) return { state: isLate(booked, ms) ? 'late' : 'booked', booking: booked };
  const next = mine.filter((b) => startMs(b) > ms).sort((a, b) => startMs(a) - startMs(b))[0];
  return { state: 'free', next };
}

// A booking is late once guests are 15 minutes past their start time and not seated.
export const LATE_MIN = 15;
export const isLate = (b, ms) => b.status === 'booked' && ms >= startMs(b) + LATE_MIN * 60000 && ms < endMs(b);

// Bookings still to arrive: late ones first, then by start time.
export function upcoming(bookings, ms) {
  return bookings.filter((b) => b.status === 'booked' && endMs(b) > ms)
    .sort((a, b) => (isLate(b, ms) - isLate(a, ms)) || startMs(a) - startMs(b));
}

// Tables with at least one booking that still counts tonight.
export const tablesBooked = (bookings) =>
  new Set(bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show').flatMap(tablesOf)).size;

export const NEXT_STATUS = { booked: ['seated', 'cancelled', 'no_show'], seated: ['done'], done: [], cancelled: [], no_show: [] };

export function summary(bookings) {
  const arrived = bookings.filter((b) => b.status === 'seated' || b.status === 'done');
  return {
    bookings: bookings.filter((b) => !b.is_walk_in).length,
    guests: arrived.reduce((n, b) => n + b.party_size, 0),
    walkIns: bookings.filter((b) => b.is_walk_in).length,
    cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    noShows: bookings.filter((b) => b.status === 'no_show').length,
  };
}
