import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/time.js';
import { dueOf, paidOf, payState, baht } from '../app/money.js';
import { fill, paymentLine, lineShareUrl } from '../app/share.js';
import { summarizeRange, toCSV } from '../app/reports.js';
import { sanitize } from '../app/log.js';

const tables = { A: { id: 'A', label: 'A1', price: 6300, color: '#D7261E' }, B: { id: 'B', label: 'A2', price: 5800, color: '#1FA448' }, C: { id: 'C', label: 'T1' } };
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

test('money: due includes extra tables and items; payment states', () => {
  const b = bk({ extra_table_ids: ['B'] });
  assert.equal(dueOf(b, tb, [{ unit_price: 700, qty: 4 }]), 6300 + 5800 + 2800);
  assert.equal(dueOf(bk({ table_id: 'C' }), tb), 0);
  assert.equal(paidOf([{ amount: 2000 }, { amount: 500 }]), 2500);
  assert.deepEqual([payState(0, 0), payState(100, 0), payState(100, 40), payState(100, 100), payState(0, 50)], ['none', 'unpaid', 'partial', 'paid', 'paid']);
  assert.equal(baht(12600), '12,600฿');
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
    bk({ id: '1', status: 'done', party_size: 5, booking_payments: [{ amount: 6300 }] }),
    bk({ id: '2', table_id: 'B', status: 'no_show', booking_payments: [{ amount: 1000 }] }),
    bk({ id: '3', table_id: 'B', night: '2030-01-11', booking_payments: [] }),
    bk({ id: '4', table_id: 'C', is_walk_in: true, status: 'seated', party_size: 2 }),
  ];
  const r = summarizeRange(list, tb);
  assert.equal(r.totals.bookings, 3);
  assert.equal(r.totals.walkIns, 1);
  assert.equal(r.totals.guests, 7);
  assert.equal(r.totals.collected, 7300);
  assert.equal(r.totals.outstanding, 5800, 'only active bookings owe money');
  assert.equal(r.totals.noShowRate, 1 / 3);
  assert.deepEqual(r.perNight.map((n) => n.night), ['2030-01-10', '2030-01-11']);
  assert.equal(r.topTables[0].label, 'A1');
  assert.equal(r.tiers[0].price, 6300);
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
