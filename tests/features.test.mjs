// Feature tests: move table, combined tables, notifications, reports + CSV, products, diagnostics/logging.
// Usage: node tests/features.test.mjs <screenshot dir>
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from '../tools/node_modules/exceljs/excel.js';

const ROOT = path.resolve(import.meta.dirname, '../app');
const SHOTS = process.argv[2] ?? '.';
const iso = (s) => new Date(s).toISOString();
const bk = (id, table, time, extra = {}) => ({
  id, table_id: table, night: '2026-10-22', start_at: iso(`2026-10-22T${time}:00+07:00`), duration_min: 120, party_size: 4,
  guest_name: 'G' + id, phone: '08100000' + id.padStart(2, '0'), note: '', status: 'booked', is_walk_in: false, extra_table_ids: [],
  created_by: 'U2', updated_by: 'U2', paid: false, amount_paid: 0, reminded_at: null, confirmed_at: null, ...extra,
});
const seed = `;
window.__db.bookings = ${JSON.stringify([
  bk('1', 'T1', '21:50'),
  bk('2', 'T2', '20:30'),
  bk('3', 'T1', '20:00', { night: '2026-10-21', start_at: iso('2026-10-21T20:00:00+07:00'), status: 'done' }),
])};
window.__db.booking_payments = [{ id: 'P1', booking_id: '3', amount: 3300, method: 'transfer', slip_path: null, created_by: 'U1', created_at: '${iso('2026-10-21T19:00:00+07:00')}' }];`;
const fake = fs.readFileSync(path.resolve(import.meta.dirname, 'fake-supabase.js'), 'utf8') + seed;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/vendor/supabase.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fake); }
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
}).listen(0);

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('[error]') && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
await page.clock.install({ time: new Date('2026-10-22T21:00:00+07:00') });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const db = () => page.evaluate(() => window.__db);
const step = (n) => console.log('ok -', n);
const more = async (v) => { await page.click('.bottomnav [data-action=more]'); await page.click(`.menu-item[data-v="${v}"]`); };

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.fill('[name=email]', 'boss@bar.test');
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForSelector('svg.floor');

  // Reminders to send: both tonight's bookings have a phone and no reminder yet
  assert.equal(await page.textContent('.phone-bell .badge'), '2');
  await page.click('.phone-bell');
  assert.equal(await page.locator('#modal [data-action=remind-open]').count(), 2);
  await page.click('#modal [data-action=remind-open] >> nth=0');
  await page.waitForSelector('#share-text');
  assert.match(await page.inputValue('#share-text'), /เตือนคุณG2/);
  await page.click('[data-action=mark-reminded]');
  await page.waitForSelector('#modal .msg-card');
  await page.click('#modal [data-action=close-modal]');
  assert.equal(await page.textContent('.phone-bell .badge'), '1', 'one reminder left');
  step('notification center lists reminders; sending one clears it');

  // Realtime: a booking made on another device shows up as a notification
  await page.evaluate(() => window.__emit('bookings', { eventType: 'INSERT', new: { id: 'X9', night: '2026-10-22', guest_name: 'Remote', table_id: 'T2', start_at: new Date('2026-10-22T23:00:00+07:00').toISOString(), created_by: 'U2' }, old: {} }));
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Remote'));
  // Late: the 20:30 booking is 30 min late at 21:00 -> one tick creates a late notification
  await page.clock.runFor(61000);
  await page.click('.phone-bell');
  const notes = await page.textContent('#modal');
  assert.match(notes, /จองใหม่: Remote/); assert.match(notes, /มาช้า 3\d นาที: G2/);
  await page.click('#modal [data-action=close-modal]');
  step('realtime new-booking and late-arrival notifications');

  // Combined tables: G1 takes T1 + T2 (T2 shows taken) -> both tables marked, due = T1 price
  await page.click('.list .brow:has-text("G1"), .upcoming .up-main:has-text("G1")');
  await page.click('#modal [data-action=edit-booking]');
  await page.click('#modal .extra-tables summary');
  await page.check('#modal .extra-tables input[value="T2"]');
  await page.click('#modal form[data-form=booking] button[type=submit]');
  await page.waitForSelector('#warnings .warn');
  await page.click('[data-action=confirm-save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  let d = await db();
  assert.deepEqual(d.bookings.find((b) => b.id === '1').extra_table_ids, ['T2']);
  await page.clock.runFor(60 * 60000);
  const cls = await page.getAttribute('svg.floor [data-tid="T2"]', 'class');
  assert.ok(/st-(booked|late|seated)/.test(cls), `T2 held by combined booking (${cls})`);
  assert.match(await page.textContent('svg.floor [data-tid="T1"]'), /4\/6/, 'guests/seats across both tables');
  step('combine tables: extra table saved and shown as held');

  // Move table: G1 -> VIP is on floor 2; move to T2 on floor 1 instead
  await page.click('[data-action=new-booking].nb').catch(() => {});
  await page.click('#modal [data-action=close-modal]').catch(() => {});
  await page.click('.bottomnav [data-v=list]');
  await page.click('.brow:has-text("G1")');
  await page.click('#modal [data-action=move-start]');
  await page.waitForSelector('.move-banner');
  await page.click('svg.floor [data-tid="T2"]');
  await page.waitForSelector('.move-banner', { state: 'detached' });
  d = await db();
  const moved = d.bookings.find((b) => b.id === '1');
  assert.equal(moved.table_id, 'T2'); assert.deepEqual(moved.extra_table_ids, [], 'extra removed when it becomes the main table');
  step('move table: tap a new table on the map');

  // Reports + CSV
  await more('reports');
  await page.waitForSelector('.bars .bar-row');
  assert.ok(await page.locator('.bar-row').count() >= 2, 'two nights');
  assert.match(await page.textContent('.stats'), /3,300฿/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=csv][data-kind=bookings][data-report]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿night,time,tables'), 'csv header with BOM');
  assert.ok(csv.includes('G1') && csv.includes('3300'), 'csv rows');
  await page.screenshot({ path: path.join(SHOTS, 'features-reports.png'), fullPage: true });
  step('reports page and CSV export');

  // Concert report: live sheet in table order, wristband from the row, Excel download
  await page.evaluate(() => { window.__db.tables.find((x) => x.id === 'T1').set_note = 'Monkey 1 ขวด'; });
  await more('concert');
  await page.waitForSelector('.xsheet tbody tr');
  const heads = await page.locator('.xsheet th').allTextContents();
  assert.deepEqual(heads, ['No.', 'ชื่อผู้จอง', 'เลขโต๊ะ', 'ชั้น', 'จำนวนคน', 'ราคา', 'ราคาที่ขายได้', 'เครื่องดื่มในเซ็ต', 'Remark', 'โปรอื่นๆ', 'Paid?', 'รับริสแบนด์แล้ว?']);
  const first = await page.locator('.xsheet tbody tr').first().locator('td').allTextContents();
  assert.equal(first[2], 'T2'); assert.equal(first[3], 'ล่าง'); assert.equal(first[10], 'ยังไม่จ่าย');
  const wbId = await page.getAttribute('.xsheet tbody tr:first-child [data-action=wristband]', 'data-id');
  await page.click('.xsheet tbody tr:first-child [data-action=wristband]');
  await page.waitForFunction((id) => window.__db.bookings.find((b) => b.id === id).wristband_at, wbId);
  await page.waitForSelector('.xsheet tbody tr:first-child .wb-check.on');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=excel]')]);
  assert.match(xl.suggestedFilename(), /^2026-10-22 Normal\.xlsx$/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(fs.readFileSync(await xl.path()));
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A1').value, '22 October 2026 - Normal');
  assert.equal(ws.getCell('C3').value, 'T2'); assert.equal(ws.getCell('L3').value, '✓');
  await page.screenshot({ path: path.join(SHOTS, 'features-concert.png'), fullPage: true });
  step('concert report: sheet columns, wristband tick, Excel download');

  // Door mode: search, one-tap check-in (seat + wristband), unpaid guests need a confirm
  await more('door');
  await page.waitForSelector('.door-card');
  await page.fill('.door-search', 'G2');
  assert.equal(await page.locator('.door-card').count(), 1, 'search narrows to G2');
  await page.click('.door-card [data-action=checkin]');
  await page.waitForFunction(() => { const b = window.__db.bookings.find((x) => x.id === '2'); return b.status === 'seated' && b.wristband_at; });
  await page.click('[data-action=door-filter][data-f=seated]');
  assert.match(await page.textContent('#door-rows'), /G2/);
  assert.match(await page.textContent('.door .stats-row'), /1\/2/);
  await page.screenshot({ path: path.join(SHOTS, 'features-door.png'), fullPage: true });
  step('door mode: search, check-in with wristband');

  // Manager undo: seated back to booked, kept in history
  await page.click('.door-card [data-action=open-booking]');
  await page.click('#modal [data-action=revert-status][data-s=booked]');
  await page.waitForFunction(() => window.__db.bookings.find((x) => x.id === '2').status === 'booked');
  await page.click('#modal [data-action=close-modal]');
  step('manager can undo a status');

  // Cash-up: by method, by staff, drawer difference
  await page.evaluate(() => { window.__db.booking_payments.push({ id: 'P2', booking_id: '2', amount: 1000, method: 'cash', slip_path: null, created_by: 'U2', created_at: new Date().toISOString() }); });
  await page.click('.bottomnav [data-v=summary]');
  await page.click('.datestrip [data-d="2026-10-22"]').catch(() => {});
  await page.waitForSelector('.cashup');
  assert.match(await page.textContent('.cashup'), /เงินสด\s*1,000฿/);
  assert.match(await page.textContent('.cashup'), /Nok\s*1,000฿/);
  await page.fill('[data-input=drawer]', '900');
  assert.match(await page.textContent('#drawer-diff'), /ขาด 100฿/);
  await page.screenshot({ path: path.join(SHOTS, 'features-cashup.png'), fullPage: true });
  step('cash-up: by method, by staff, drawer short/over');

  // Products: add a package in settings, it appears in the booking extras picker
  await more('settings');
  const newRow = page.locator('form[data-form=product]').last();
  await newRow.locator('[name=name]').fill('Regency 500ml');
  await newRow.locator('[name=price]').fill('900');
  await newRow.locator('button[type=submit]').click();
  await page.waitForFunction(() => window.__db.products.some((p) => p.name === 'Regency 500ml'));
  step('products managed in settings');

  // Diagnostics: errors are logged locally and sent to the server log table, personal data redacted
  await page.evaluate(() => { const el = document.createElement('script'); el.textContent = 'throw new Error("boom-test")'; document.body.append(el); });
  await page.clock.runFor(5000);
  await page.waitForFunction(() => window.__db.app_logs.some((l) => l.event === 'window.error'));
  d = await db();
  const errLog = d.app_logs.find((l) => l.event === 'window.error');
  assert.equal(errLog.level, 'error'); assert.ok(errLog.app_version, 'version attached');
  await page.click('[data-action=server-logs]');
  await page.waitForSelector('#server-logs .log-row');
  assert.match(await page.textContent('#server-logs'), /window\.error/);
  await page.click('[data-action=debug-toggle]');
  assert.match(await page.textContent('.diag'), /ปิดโหมด Debug/);
  await page.screenshot({ path: path.join(SHOTS, 'features-settings.png'), fullPage: true });
  step('logging: global errors captured, sent to server, visible in diagnostics');

  assert.deepEqual(errors.filter((e) => !e.includes('boom-test')), [], 'no unexpected browser errors');
  console.log('ALL FEATURE TESTS PASSED');
} catch (e) {
  await page.screenshot({ path: path.join(SHOTS, 'features-failure.png'), fullPage: true }).catch(() => {});
  console.error('FAILED:', e.message, '\nbrowser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
