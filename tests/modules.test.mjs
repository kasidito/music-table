import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/time.js';
import { dueOf, paidOf, netPriceOf, receivedOf, baht } from '../app/money.js';
import { fill, paymentLine, lineShareUrl } from '../app/share.js';
import { summarizeRange, toCSV, concertRows, freeTables, cashUp } from '../app/reports.js';
import { concertWorkbook } from '../app/concert-xlsx.js';
import ExcelJS from '../tools/node_modules/exceljs/excel.js';
import { sanitize } from '../app/log.js';

const tables = { A: { id: 'A', label: 'A1', price: 6300, color: '#D7261E', floor: 1, set_note: 'Monkey 1 ขวด' }, B: { id: 'B', label: 'A2', price: 5800, color: '#1FA448', floor: 1 }, C: { id: 'C', label: 'T1', floor: 1 }, D: { id: 'D', label: 'B1', price: 7600, floor: 2, set_note: 'Monkey 2 ขวด' } };
const tb = (id) => tables[id];
const at = (s) => new Date(`2030-01-10T${s}:00+07:00`).toISOString();
const bk = (o) => ({ id: 'x', table_id: 'A', extra_table_ids: [], start_at: at('20:00'), duration_min: 120, status: 'booked', party_size: 4, is_walk_in: false, night: '2030-01-10', ...o });

test('combined tables: conflicts, state and count use every table', () => {
  const big = bk({ id: '1', table_id: 'A', extra_table_ids: ['B'] });
  assert.equal(T.conflictsFor(bk({ id: '2', table_id: 'B' }), [big]).length, 1, 'extra table clashes');
  assert.equal(T.conflictsFor(bk({ id: '2', table_id: 'C', extra_table_ids: ['A'] }), [big]).length, 1, 'draft extra clashes');
  assert.equal(T.conflictsFor(bk({ id: '2', table_id: 'C' }), [big]).length, 0);
  assert.equal(T.tableStateAt('B', [big], Date.parse(at('20:05'))).state, 'booked');
  assert.equal(T.tablesBooked([big]), 2);
});

test('money: due includes extra tables, items, category discount and agreed price', () => {
  const b = bk({ extra_table_ids: ['B'] });
  assert.equal(dueOf(b, tb, [{ unit_price: 700, qty: 4 }]), 6300 + 5800 + 2800);
  assert.equal(dueOf(bk({ table_id: 'C' }), tb), 0);
  const partner = { discount_pct: 10 };
  assert.equal(netPriceOf(bk({}), tb, partner), 5670, '10% off 6,300 (whole baht, like the database)');
  assert.equal(dueOf(bk({ sold_price: 6000 }), tb, [{ unit_price: 1990, qty: 1 }], partner), 7990, 'agreed price wins over discount');
  assert.equal(paidOf([{ amount: 2000 }, { amount: 500 }]), 2500);
  assert.equal(receivedOf('paid', 6300, 0), 6300, 'marked paid counts in full');
  assert.equal(receivedOf('deposit', 6300, 2000), 2000);
  assert.equal(baht(12600), '12,600฿');
});

test('whole-night mode: any booking on the table clashes; table shows booked all night', () => {
  const early = bk({ id: '1', start_at: at('19:00'), duration_min: 60 });
  const late = bk({ id: '2', start_at: at('23:00') });
  assert.equal(T.conflictsFor(late, [early]).length, 0, 'timed: no overlap');
  assert.equal(T.conflictsFor(late, [early], { wholeNight: true }).length, 1, 'whole night: same table clashes');
  assert.equal(T.tableStateAt('A', [late], Date.parse(at('19:30'))).state, 'free');
  assert.equal(T.tableStateAt('A', [late], Date.parse(at('19:30')), { wholeNight: true }).state, 'booked');
  const s = { open_time: '18:00:00', close_time: '02:00:00' };
  assert.equal(T.minutesToClose('2030-01-10', at('20:00'), s), 360);
  assert.equal(T.minutesToClose('2030-01-10', new Date('2030-01-11T01:30:00+07:00').toISOString(), s), 30);
});

test('concert rows: table order, prices, set drinks, promo, pay status, wristband, free tables', () => {
  const cats = { P: { id: 'P', name: 'เพื่อนหุ้นส่วน', discount_pct: 10 } };
  const list = [
    bk({ id: '1', table_id: 'D', guest_name: 'ปุ่น', phone: '0914156946', party_size: 8, pay_status: 'paid', wristband_at: '2030-01-10T13:00:00Z' }),
    bk({ id: '2', table_id: 'A', guest_name: 'ชาช่า', category_id: 'P', pay_status: 'waiting', note: 'A3+A7', booking_items: [{ name: 'SET', qty: 1 }] }),
    bk({ id: '3', table_id: 'B', status: 'cancelled' }),
  ];
  const { rows, totals } = concertRows(list, tb, (id) => cats[id] ?? null);
  assert.deepEqual(rows.map((r) => [r.no, r.tables]), [[1, 'A1'], [2, 'B1']], 'floor then table; cancelled left out');
  assert.equal(rows[0].netPrice, 5670); assert.equal(rows[0].listPrice, 6300);
  assert.equal(rows[0].setDrinks, 'Monkey 1 ขวด + SET ×1');
  assert.equal(rows[0].category, 'เพื่อนหุ้นส่วน'); assert.equal(rows[0].payStatus, 'waiting');
  assert.equal(rows[1].wristband, true);
  assert.deepEqual([totals.bookings, totals.people, totals.listPrice, totals.netPrice, totals.wristbands, totals.byPay.paid], [2, 12, 13900, 13270, 1, 1]);
  assert.deepEqual(freeTables(Object.values(tables), list).map((x) => x.label), ['A2', 'T1'], 'cancelled booking frees A2');
});

test('concert excel: header, rows, yellow for not-paid, totals', async () => {
  const { rows, totals } = concertRows([bk({ id: '1', guest_name: 'ไตเติ้ล', phone: '0909602525', pay_status: 'at_venue' })], tb);
  const labels = { headers: ['No.', 'ชื่อผู้จอง', 'เลขโต๊ะ', 'ชั้น', 'จำนวนคน', 'ราคา', 'ราคาที่ขายได้', 'เครื่องดื่มในเซ็ต', 'Remark', 'โปรอื่นๆ', 'Paid?', 'รับริสแบนด์แล้ว?'],
    floor: { 1: 'ล่าง', 2: 'บน' }, none: 'N/A', yes: '✓', total: 'รวม', pay: { at_venue: 'จ่ายหน้างาน', paid: 'จ่ายครบ' } };
  const buf = await concertWorkbook(ExcelJS, { title: '12 October 2026 - Purpeech', rows, totals, labels, sheetName: 'Purpeech' });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Purpeech');
  assert.equal(ws.getCell('A1').value, '12 October 2026 - Purpeech');
  assert.equal(ws.getCell('B2').value, 'ชื่อผู้จอง');
  assert.equal(ws.getCell('A2').fill.fgColor.argb, 'FF000000');
  assert.deepEqual([ws.getCell('B3').value, ws.getCell('C3').value, ws.getCell('D3').value, ws.getCell('F3').value, ws.getCell('J3').value, ws.getCell('K3').value],
    ['ไตเติ้ล 0909602525', 'A1', 'ล่าง', 6300, 'N/A', 'จ่ายหน้างาน']);
  assert.equal(ws.getCell('K3').fill.fgColor.argb, 'FFFFFF00', 'not-paid highlighted yellow');
  assert.equal(ws.getCell('F3').numFmt, '#,##0.00');
  assert.equal(ws.getCell('G4').value, 6300, 'totals row');
});

test('share: template fill, payment line, LINE link', () => {
  assert.equal(fill('สวัสดี {name} โต๊ะ {table} {unknown}', { name: 'Mia', table: 'A1' }), 'สวัสดี Mia โต๊ะ A1 {unknown}');
  assert.equal(fill('a\n{payment}\n\n\nb', { payment: '' }), 'a\n\nb');
  assert.equal(paymentLine(6300, 2000), 'ยอดรวม 6,300฿ · ชำระแล้ว 2,000฿ · คงเหลือ 4,300฿');
  assert.equal(paymentLine(6300, 6300), 'ชำระครบแล้ว 6,300฿');
  assert.equal(paymentLine(0, 0), '');
  assert.equal(lineShareUrl('ก & b'), 'https://line.me/R/share?text=%E0%B8%81%20%26%20b');
});

test('reports: totals, no-show rate, outstanding, top tables, tiers', () => {
  const list = [
    bk({ id: '1', status: 'done', party_size: 5, pay_status: 'paid', booking_payments: [{ amount: 6300 }] }),
    bk({ id: '2', table_id: 'B', status: 'no_show', pay_status: 'deposit', booking_payments: [{ amount: 1000 }] }),
    bk({ id: '3', table_id: 'B', night: '2030-01-11', booking_payments: [] }),
    bk({ id: '4', table_id: 'C', is_walk_in: true, status: 'seated', party_size: 2 }),
  ];
  const r = summarizeRange(list, tb);
  assert.equal(r.totals.bookings, 3);
  assert.equal(r.totals.walkIns, 1);
  assert.equal(summarizeRange([bk({ pay_status: 'paid' })], tb).totals.collected, 6300, 'marked paid without a payment row still counts');
  assert.equal(r.totals.guests, 7);
  assert.equal(r.totals.collected, 7300);
  assert.equal(r.totals.outstanding, 5800, 'only active bookings owe money');
  assert.equal(r.totals.noShowRate, 1 / 3);
  assert.deepEqual(r.perNight.map((n) => n.night), ['2030-01-10', '2030-01-11']);
  assert.equal(r.topTables[0].label, 'A1');
  assert.equal(r.tiers[0].price, 6300);
});

test('cash-up: by method and staff, marked-paid-but-unrecorded, still to collect', () => {
  const list = [
    bk({ id: '1', pay_status: 'paid', booking_payments: [{ amount: 2000, method: 'transfer', created_by: 'U1' }, { amount: 4300, method: 'cash', created_by: 'U2' }] }),
    bk({ id: '2', table_id: 'B', pay_status: 'paid', booking_payments: [] }),
    bk({ id: '3', table_id: 'D', pay_status: 'deposit', booking_payments: [{ amount: 1000, method: 'transfer', created_by: 'U2' }] }),
    bk({ id: '4', table_id: 'D', pay_status: 'at_venue', booking_payments: [] }),
    bk({ id: '5', table_id: 'D', pay_status: 'unpaid', status: 'cancelled' }),
    bk({ id: '6', table_id: 'C', pay_status: 'unpaid' }),
  ];
  const c = cashUp(list, (b) => dueOf(b, tb));
  assert.deepEqual(c.byMethod, { cash: 4300, transfer: 3000, card: 0 });
  assert.deepEqual(c.byStaff, [{ id: 'U2', amount: 5300 }, { id: 'U1', amount: 2000 }]);
  assert.equal(c.unrecorded, 5800, 'A2 marked paid with no payment row');
  assert.equal(c.total, 13100);
  assert.deepEqual(c.outstanding.map((o) => [o.booking.id, o.left]), [['3', 6600], ['4', 7600]], 'cancelled and free tables left out');
  assert.equal(c.toCollect, 14200);
});

test('csv: BOM, quoting, Thai text', () => {
  const csv = toCSV([{ a: 'สมชาย, "VIP"', b: 1 }], [{ label: 'ชื่อ', get: (r) => r.a }, { label: 'n', get: (r) => r.b }]);
  assert.equal(csv, '﻿ชื่อ,n\r\n"สมชาย, ""VIP""",1\r\n');
});

test('log sanitize: redacts personal data, trims, keeps errors', () => {
  const out = sanitize({ phone: '0812345678', guest_name: 'Mia', table: 'A1', nested: { email: 'a@b.c', ok: 1 }, long: 'x'.repeat(600), err: new Error('boom') });
  assert.equal(out.phone, '[redacted]');
  assert.equal(out.guest_name, '[redacted]');
  assert.equal(out.nested.email, '[redacted]');
  assert.equal(out.table, 'A1');
  assert.equal(out.long.length, 501);
  assert.equal(out.err.message, 'boom');
});
