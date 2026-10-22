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

export function conflictsFor(draft, bookings) {
  return bookings.filter((b) =>
    b.id !== draft.id && b.table_id === draft.table_id && isActive(b) &&
    startMs(draft) < endMs(b) && startMs(b) < endMs(draft));
}

// What a table looks like at a moment: seated holds the table until marked done.
export function tableStateAt(tableId, bookings, ms) {
  const mine = bookings.filter((b) => b.table_id === tableId && isActive(b));
  const seated = mine.find((b) => b.status === 'seated' && startMs(b) <= ms);
  if (seated) return { state: 'seated', booking: seated };
  const booked = mine.find((b) => b.status === 'booked' && startMs(b) <= ms && ms < endMs(b));
  if (booked) return { state: 'booked', booking: booked };
  const next = mine.filter((b) => startMs(b) > ms).sort((a, b) => startMs(a) - startMs(b))[0];
  return { state: 'free', next };
}

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
