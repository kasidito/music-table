// Aggregates for the reports page and CSV export. Pure functions: no DOM, no network.
import { tableIdsOf, dueOf, paidOf } from './money.js';

const ACTIVE = (b) => b.status !== 'cancelled' && b.status !== 'no_show';

export function summarizeRange(bookings, tableById) {
  const nights = new Map();
  const tables = new Map();
  const tiers = new Map();
  const t = { bookings: 0, guests: 0, walkIns: 0, cancelled: 0, noShows: 0, collected: 0, outstanding: 0, nights: 0 };
  for (const b of bookings) {
    const n = nights.get(b.night) ?? { night: b.night, bookings: 0, guests: 0, collected: 0, noShows: 0 };
    nights.set(b.night, n);
    const paid = paidOf(b.booking_payments);
    const due = dueOf(b, tableById, b.booking_items);
    t.collected += paid; n.collected += paid;
    if (b.is_walk_in) t.walkIns++; else { t.bookings++; n.bookings++; }
    if (b.status === 'cancelled') t.cancelled++;
    if (b.status === 'no_show') { t.noShows++; n.noShows++; }
    if (b.status === 'seated' || b.status === 'done') { t.guests += b.party_size; n.guests += b.party_size; }
    if (ACTIVE(b)) {
      t.outstanding += Math.max(0, due - paid);
      for (const id of tableIdsOf(b)) {
        const tb = tableById(id);
        if (!tb) continue;
        const row = tables.get(tb.label) ?? { label: tb.label, count: 0 };
        row.count++; tables.set(tb.label, row);
        if (tb.color) {
          const tier = tiers.get(tb.color) ?? { color: tb.color, price: tb.price, count: 0 };
          tier.count++; tiers.set(tb.color, tier);
        }
      }
    }
  }
  t.nights = nights.size;
  const reservable = t.bookings;
  t.noShowRate = reservable ? t.noShows / reservable : 0;
  return {
    totals: t,
    perNight: [...nights.values()].sort((a, b) => a.night.localeCompare(b.night)),
    topTables: [...tables.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true })).slice(0, 8),
    tiers: [...tiers.values()].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)),
  };
}

// RFC 4180 CSV with a UTF-8 BOM so Thai text opens correctly in Google Sheets / Excel.
export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.get(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
