// End-to-end UI test against the in-memory Supabase stand-in.
// Usage: node tests/ui.test.mjs <screenshot dir>
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '../app');
const FAKE = path.resolve(import.meta.dirname, 'fake-supabase.js');
const SHOTS = process.argv[2] ?? '.';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = p === '/vendor/supabase.js' ? FAKE : path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let promptAnswer = '';
page.on('dialog', (d) => d.accept(promptAnswer));
await page.clock.setFixedTime(new Date('2026-10-22T21:00:00+07:00'));

const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
const db = () => page.evaluate(() => window.__db);
const step = (name) => console.log('ok -', name);

try {
  await page.goto(URL_);
  await page.waitForSelector('form[data-form=login]');
  await shot('01-login');

  await page.fill('[name=email]', 'boss@bar.test');
  await page.fill('[name=password]', 'wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('.toast.show.bad');
  assert.match(await page.textContent('#toast'), /รหัสผ่านไม่ถูกต้อง/);
  step('wrong password shows Thai error');

  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForSelector('svg.floor');
  assert.equal(await page.locator('svg.floor [data-tid]').count(), 2, 'floor 1 has 2 tables');
  for (const tab of ['แก้ผัง', 'พนักงาน', 'ตั้งค่า']) assert.ok(await page.locator('.tab', { hasText: tab }).count());
  step('manager logs in, sees floor 1 and manager tabs');

  // New booking from a table
  await page.click('svg.floor [data-tid=T1]');
  await page.click('#modal [data-action=new-booking]');
  await page.fill('#modal [name=guest_name]', 'สมชาย');
  await page.fill('#modal [name=phone]', '0812345678');
  await page.fill('#modal [name=party_size]', '4');
  await page.selectOption('#modal [name=time]', '20:00');
  await shot('02-booking-form');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  let d = await db();
  assert.equal(d.bookings.length, 1);
  assert.equal(d.bookings[0].night, '2026-10-22');
  assert.equal(d.bookings[0].table_id, 'T1');
  assert.equal(await page.getAttribute('svg.floor [data-tid=T1]', 'class'), 'tbl st-booked');
  step('booking created and table turns booked at 21:00');

  // Overlap + too many guests -> warning, then save anyway
  await page.click('.toolbar [data-action=new-booking]');
  await page.fill('#modal [name=guest_name]', 'Overlap');
  await page.fill('#modal [name=phone]', '0800000000');
  await page.fill('#modal [name=party_size]', '6');
  await page.selectOption('#modal [name=time]', '21:00');
  await page.selectOption('#modal [name=table_id]', 'T1');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#warnings .warn');
  const warn = await page.textContent('#warnings');
  assert.match(warn, /สมชาย/); assert.match(warn, /เกินที่นั่ง/);
  await shot('03-overlap-warning');
  assert.equal((await db()).bookings.length, 1, 'not saved before confirming');
  await page.click('[data-action=confirm-save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  assert.equal((await db()).bookings.length, 2);
  step('overlap and capacity warnings shown, save anyway works');

  // After-midnight booking belongs to tonight
  await page.click('.toolbar [data-action=new-booking]');
  await page.fill('#modal [name=guest_name]', 'Late');
  await page.fill('#modal [name=phone]', '0811111111');
  await page.selectOption('#modal [name=time]', '01:00');
  await page.selectOption('#modal [name=table_id]', 'T3');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  d = await db();
  const late = d.bookings.find((b) => b.guest_name === 'Late');
  assert.equal(late.start_at, '2026-10-22T18:00:00.000Z', '01:00 is the next calendar day');
  assert.equal(late.night, '2026-10-22');
  step('01:00 booking saved for tonight');

  // Walk-in on a free table
  await page.click('svg.floor [data-tid=T2]');
  await page.click('#modal [data-action=walk-in]');
  await page.fill('#modal [name=party_size]', '2');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  d = await db();
  const walk = d.bookings.find((b) => b.is_walk_in);
  assert.equal(walk.status, 'seated'); assert.equal(walk.table_id, 'T2');
  assert.equal(await page.getAttribute('svg.floor [data-tid=T2]', 'class'), 'tbl st-seated');
  await shot('04-map-with-bookings');
  step('walk-in added in 3 taps and table shows seated');

  // List, open booking, seat then done, history
  await page.click('.tab:has-text("รายการจอง")');
  assert.equal(await page.locator('.brow').count(), 4);
  await page.click('.brow:has-text("สมชาย")');
  await page.click('[data-action=set-status][data-s=seated]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.click('.brow:has-text("สมชาย")');
  await page.waitForSelector('#history .hrow');
  assert.equal(await page.locator('#history .hrow').count(), 2);
  assert.match(await page.textContent('#history'), /จองแล้ว → นั่งแล้ว/);
  assert.match(await page.textContent('#history'), /Boss/);
  await shot('05-booking-detail');
  await page.click('[data-action=set-status][data-s=done]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.click('.brow:has-text("Overlap")');
  await page.click('[data-action=set-status][data-s=no_show]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  d = await db();
  assert.equal(d.bookings.find((b) => b.guest_name === 'สมชาย').status, 'done');
  step('status changes and history with who/before/after');

  // Edit booking
  await page.click('.brow:has-text("Late")');
  await page.click('[data-action=edit-booking]');
  await page.fill('#modal [name=note]', 'วันเกิด');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  assert.equal((await db()).bookings.find((b) => b.guest_name === 'Late').note, 'วันเกิด');
  await shot('06-list');
  step('edit booking');

  // Summary
  await page.click('.tab:has-text("สรุปรายคืน")');
  const nums = await page.locator('.stat .num').allTextContents();
  assert.deepEqual(nums, ['3', '6', '1', '0', '1'], 'bookings, guests (4 done + 2 walk-in), walk-ins, cancelled, no-show');
  await shot('07-summary');
  step('nightly summary numbers');

  // Layout editor: add, drag, edit, duplicate
  await page.click('.tab:has-text("แก้ผัง")');
  await page.click('[data-action=table-add]');
  await page.waitForSelector('form[data-form=table]');
  d = await db();
  const added = d.tables.find((x) => x.layout_id === 'L1' && !['T1', 'T2', 'T3'].includes(x.id));
  assert.equal(added?.label, 'T4', 'new table gets next free name');
  const box = await page.locator(`#editor-svg [data-tid="${added.id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  d = await db();
  const moved = d.tables.find((x) => x.id === added.id);
  assert.ok(moved.x < 500 && moved.y > 350, `table moved (${moved.x},${moved.y})`);
  assert.equal(moved.x % 10, 0, 'snapped to grid');
  await page.fill('form[data-form=table] [name=label]', 'Bar 1');
  await page.fill('form[data-form=table] [name=seats]', '6');
  await page.selectOption('form[data-form=table] [name=shape]', 'round');
  await page.click('form[data-form=table] button[type=submit]');
  await page.waitForTimeout(100);
  d = await db();
  assert.deepEqual([d.tables.find((x) => x.id === added.id).label, d.tables.find((x) => x.id === added.id).seats], ['Bar 1', 6]);
  await shot('08-layout-editor');
  promptAnswer = 'Concert';
  await page.click('[data-action=layout-dup]');
  await page.waitForTimeout(100);
  d = await db();
  const concert = d.layouts.find((l) => l.name === 'Concert');
  assert.equal(d.tables.filter((x) => x.layout_id === concert.id).length, 4);
  step('layout editor: add, drag with snap, edit, duplicate');

  // Remove a table from Concert, then switch tonight to Concert -> mapping dialog
  const cT2 = d.tables.find((x) => x.layout_id === concert.id && x.label === 'T2');
  await page.selectOption('[data-change=edit-layout]', concert.id);
  await page.click(`#editor-svg [data-tid="${cT2.id}"]`);
  await page.click('[data-action=table-remove]');
  await page.waitForTimeout(100);
  assert.ok((await db()).tables.find((x) => x.id === cT2.id).archived);
  await page.click('.tab:has-text("ผังร้าน")');
  await page.selectOption('[data-change=night-layout]', concert.id);
  await page.waitForSelector('form[data-form=mapping]');
  await shot('09-move-bookings');
  const sels = page.locator('form[data-form=mapping] select');
  assert.equal(await sels.count(), 2, 'Late on VIP and walk-in on T2 need new tables');
  // VIP pre-selected by same label; T2 does not exist in Concert -> choose T1
  const cT1 = d.tables.find((x) => x.layout_id === concert.id && x.label === 'T1');
  await page.selectOption('form[data-form=mapping] select[name=T2]', cT1.id);
  await page.click('form[data-form=mapping] button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  d = await db();
  assert.equal(d.day_layouts[0].layout_id, concert.id);
  for (const b of d.bookings.filter((x) => ['booked', 'seated'].includes(x.status))) {
    assert.equal(d.tables.find((x) => x.id === b.table_id).layout_id, concert.id);
  }
  step('switch night to Concert with booking mapping');

  // Staff and settings
  await page.click('.tab:has-text("พนักงาน")');
  await page.fill('form[data-form=staff] [name=display_name]', 'Mai');
  await page.fill('form[data-form=staff] [name=email]', 'mai@bar.test');
  await page.fill('form[data-form=staff] [name=password]', 'longpassword');
  await page.click('form[data-form=staff] button[type=submit]');
  await page.waitForSelector('.srow:has-text("Mai")');
  await shot('10-staff');
  await page.click('.tab:has-text("ตั้งค่า")');
  await page.fill('form[data-form=settings] [name=default_duration_min]', '90');
  await page.click('form[data-form=settings] button[type=submit]');
  await page.waitForTimeout(100);
  assert.equal((await db()).settings[0].default_duration_min, 90);
  step('add staff account and change settings');

  // Language
  await page.click('[data-action=lang]');
  assert.ok(await page.locator('.tab', { hasText: 'Floor map' }).count());
  await page.click('.tab:has-text("Floor map")');
  await shot('11-map-english');
  const thKeys = await page.evaluate(async () => {
    const m = await import('./i18n.js');
    const th = Object.keys(m.KEYS.th), en = Object.keys(m.KEYS.en);
    return { missingEn: th.filter((k) => !en.includes(k)), missingTh: en.filter((k) => !th.includes(k)) };
  });
  assert.deepEqual(thKeys, { missingEn: [], missingTh: [] });
  step('language switch to English, every label has both languages');

  // Staff role: no manager tabs
  await page.click('[data-action=logout]');
  await page.waitForSelector('form[data-form=login]');
  await page.fill('[name=email]', 'staff@bar.test');
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForSelector('svg.floor');
  assert.equal(await page.locator('.tab').count(), 3);
  assert.equal(await page.locator('[data-change=night-layout]').count(), 0);
  step('staff sees no manager tabs or layout picker');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('ALL UI TESTS PASSED');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('FAILED:', e.message, '\nbrowser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
