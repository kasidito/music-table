// Aggregates for the reports page and CSV export. Pure functions: no DOM, no network.
import { tableIdsOf, dueOf, paidOf, listPriceOf, netPriceOf, receivedOf, stillOwes } from './money.js';

const ACTIVE = (b) => b.status !== 'cancelled' && b.status !== 'no_show';

export function summarizeRange(bookings, tableById, categoryById = () => null) {
  const nights = new Map();
  const tables = new Map();
  const tiers = new Map();
  const t = { bookings: 0, guests: 0, walkIns: 0, cancelled: 0, noShows: 0, collected: 0, outstanding: 0, nights: 0 };
  for (const b of bookings) {
    const n = nights.get(b.night) ?? { night: b.night, bookings: 0, guests: 0, collected: 0, noShows: 0 };
    nights.set(b.night, n);
    const due = dueOf(b, tableById, b.booking_items, categoryById(b.category_id));
    const paidRec = paidOf(b.booking_payments);
    const paid = receivedOf(b.pay_status, due, paidRec);
    t.collected += paid; n.collected += paid;
    if (b.is_walk_in) t.walkIns++; else { t.bookings++; n.bookings++; }
    if (b.status === 'cancelled') t.cancelled++;
    if (b.status === 'no_show') { t.noShows++; n.noShows++; }
    if (b.status === 'seated' || b.status === 'done') { t.guests += b.party_size; n.guests += b.party_size; }
    if (ACTIVE(b)) {
      if (stillOwes(b.pay_status)) t.outstanding += Math.max(0, due - paidRec);
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

// Concert sheet: one row per live booking, in table order, like the bar's own Excel sheet.
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
export function concertRows(bookings, tableById, categoryById = () => null) {
  const live = bookings.filter(ACTIVE).map((b) => {
    const tbs = tableIdsOf(b).map(tableById).filter(Boolean);
    const cat = categoryById(b.category_id);
    const items = (b.booking_items ?? []).map((i) => `${i.name} ×${i.qty}`);
    return {
      booking: b,
      name: b.guest_name || '',
      phone: b.phone || '',
      tables: tbs.map((x) => x.label).join('+'),
      floor: Math.min(...tbs.map((x) => x.floor)),
      party: b.party_size,
      listPrice: listPriceOf(b, tableById),
      netPrice: netPriceOf(b, tableById, cat),
      setDrinks: [...tbs.map((x) => x.set_note).filter(Boolean), ...items].join(' + '),
      note: b.note || '',
      category: cat?.name ?? '',
      discount: cat?.discount_pct ?? 0,
      payStatus: b.pay_status ?? 'unpaid',
      wristband: !!b.wristband_at,
      sortKey: tbs[0] ? [tbs[0].floor, tbs[0].label] : [9, ''],
    };
  }).sort((a, b) => a.sortKey[0] - b.sortKey[0] || natural(a.sortKey[1], b.sortKey[1]));
  live.forEach((r, i) => { r.no = i + 1; });
  const totals = {
    bookings: live.length,
    people: live.reduce((n, r) => n + r.party, 0),
    listPrice: live.reduce((n, r) => n + r.listPrice, 0),
    netPrice: live.reduce((n, r) => n + r.netPrice, 0),
    wristbands: live.filter((r) => r.wristband).length,
    byPay: live.reduce((m, r) => ({ ...m, [r.payStatus]: (m[r.payStatus] ?? 0) + 1 }), {}),
  };
  return { rows: live, totals };
}

// Tables nobody holds tonight (for "still for sale").
export function freeTables(layoutTables, bookings) {
  const held = new Set(bookings.filter(ACTIVE).flatMap(tableIdsOf));
  return layoutTables.filter((x) => !held.has(x.id)).sort((a, b) => a.floor - b.floor || natural(a.label, b.label));
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
