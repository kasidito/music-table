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
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
const db = () => page.evaluate(() => window.__db);
const step = (name) => console.log('ok -', name);
async function go(v) {
  const direct = page.locator(`.bottomnav [data-v="${v}"]`);
  if (await direct.count()) return direct.click();
  await page.click('.bottomnav [data-action=more]');
  await page.click(`.menu-item[data-v="${v}"]`);
}

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
  await page.click('.bottomnav [data-action=more]');
  for (const v of ['layouts', 'staff', 'settings']) assert.ok(await page.locator(`.menu-item[data-v="${v}"]`).count(), v);
  await page.click('#modal [data-action=close-modal]');
  assert.equal(await page.locator('svg.floor .fx-stage').count(), 1, 'stage drawn');
  await page.click('svg.floor .fx-stage');
  assert.ok(await page.locator('#modal').isHidden(), 'stage is not bookable');
  step('manager logs in, sees floor 1 with stage and manager tabs');

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
  const cls = async (sel) => (await page.getAttribute(sel, 'class')).split(/\s+/);
  assert.ok((await cls('svg.floor [data-tid=T1]')).includes('st-late'));
  assert.match(await page.textContent('.stats-row'), /มาช้า/);
  assert.match(await page.textContent('.upcoming'), /สมชาย/);
  step('booking created; at 21:00 the 20:00 booking shows late on map, stats and arriving list');

  // Overlap + too many guests -> warning, then save anyway
  await page.click('[data-action=new-booking].nb');
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
  await page.click('[data-action=new-booking].nb');
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
  assert.ok((await cls('svg.floor [data-tid=T2]')).includes('st-seated'));
  await shot('04-map-with-bookings');
  step('walk-in added in 3 taps and table shows seated');

  // List, open booking, seat then done, history
  await go('list');
  assert.equal(await page.locator('.brow').count(), 4);
  await page.click('.brow:has-text("สมชาย")');
  await page.click('[data-action=set-status][data-s=seated]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.click('.brow:has-text("สมชาย")');
  assert.ok(await page.locator('#modal .steps li.now:has-text("มาแล้ว")').count(), 'status track shows Arrived');
  await page.click('#modal details[data-fold=history] summary');
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

  // Payment: deposit with slip -> deposit; rest in cash -> paid; history records it
  assert.ok(await page.locator('.brow:has-text("สมชาย") .pill.ps-unpaid').count(), 'priced booking shows unpaid');
  await page.click('.brow:has-text("สมชาย")');
  await page.waitForSelector('#modal .pay-blk.is-unpaid');
  assert.equal(await page.locator('#modal .pay-tile').count(), 5, 'five payment status buttons');
  assert.equal(await page.getAttribute('#modal .pay-tile.on', 'data-s'), 'unpaid');
  assert.match(await page.textContent('#modal .pay-blk'), /3,300฿/);
  await page.click('#modal details[data-fold=record] summary');
  assert.equal(await page.inputValue('#modal form[data-form=payment] [name=amount]'), '3300', 'amount defaults to remaining');
  await page.fill('#modal form[data-form=payment] [name=amount]', '1000');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#modal form[data-form=payment] input[name=slip]', { name: 'slip.png', mimeType: 'image/png', buffer: png });
  await page.click('#modal form[data-form=payment] button[type=submit]');
  await page.waitForSelector('#modal .pay-blk.is-deposit');
  await page.waitForFunction(() => document.querySelector('#modal .slip-thumb img')?.src.startsWith('blob:'));
  assert.match(await page.textContent('#modal .pay-tile.on'), /มัดจำแล้ว/);
  assert.equal(await page.inputValue('#modal form[data-form=payment] [name=amount]'), '2300', 'next amount = remaining');
  await page.selectOption('#modal form[data-form=payment] [name=method]', 'cash');
  await page.click('#modal form[data-form=payment] button[type=submit]');
  await page.waitForSelector('#modal .pay-blk.is-paid');
  d = await db();
  const ov = d.bookings.find((b) => b.guest_name === 'สมชาย');
  assert.ok(ov.paid && ov.amount_paid === 3300 && ov.paid_by === 'U1', 'paid in full, stamped');
  assert.equal(d.booking_payments.filter((x) => x.booking_id === ov.id).length, 2);
  assert.ok(/^[\w-]+\/slip-\d+\.jpg$/.test(d.booking_payments[0].slip_path), 'slip stored under booking id');
  await shot('05b-paid-slip');
  await page.click('#modal details[data-fold=history] summary');
  await page.waitForSelector('#history .hrow');
  assert.match(await page.textContent('#history'), /ยังไม่จ่าย → มัดจำแล้ว/);
  assert.match(await page.textContent('#history'), /มัดจำแล้ว → จ่ายครบ/);
  await page.click('#modal [data-action=close-modal]');
  assert.ok(await page.locator('.brow:has-text("สมชาย") .pill.ps-paid').count());
  step('payment: deposit with slip (deposit), remaining in cash (paid in full), history');

  // Payment status by one tap, without recording money
  await page.click('.brow:has-text("Overlap")');
  await page.click('#modal .pay-tile[data-s=waiting]');
  await page.waitForSelector('#modal .pay-tile.on[data-s=waiting]');
  assert.equal((await db()).bookings.find((b) => b.guest_name === 'Overlap').pay_status, 'waiting');
  await page.click('#modal .pay-tile[data-s=at_venue]');
  await page.waitForSelector('#modal .pay-tile.on[data-s=at_venue]');
  assert.equal((await db()).bookings.find((b) => b.guest_name === 'Overlap').pay_status, 'at_venue');
  await page.click('#modal [data-action=close-modal]');
  step('payment status: one tap on Waiting / Pay at door');

  // Extras: package per person adds to the amount due
  await page.click('.brow:has-text("Late")');
  await page.click('#modal details[data-fold=items] summary');
  await page.waitForSelector('#modal form[data-form=item]');
  assert.equal(await page.inputValue('#modal form[data-form=item] [name=qty]'), '2', 'per-person package qty = party size');
  await page.click('#modal form[data-form=item] button[type=submit]');
  await page.waitForSelector('#modal .items-card .pay-row');
  assert.match(await page.textContent('#modal .pay-blk'), /1,400฿/);
  step('extras: per-person package adds to amount due');

  // LINE message: prepared text, LINE link, mark as sent
  await page.click('#modal details[data-fold=messages] summary');
  await page.click('#modal [data-action=share][data-kind=confirm]');
  const msg = await page.inputValue('#share-text');
  assert.match(msg, /คุณLate/); assert.match(msg, /ยอดรวม 1,400฿/);
  assert.match(await page.getAttribute('#share-line', 'href'), /^https:\/\/line\.me\/R\/share\?text=/);
  await page.click('[data-action=mark-reminded]');
  await page.waitForSelector('#modal .msg-card');
  assert.match(await page.textContent('#modal .msg-card'), /ส่งเตือนแล้ว/);
  await page.click('#modal [data-action=mark-confirmed][data-v="1"]');
  await page.waitForSelector('#modal .msg-card [data-v="0"]');
  assert.ok((await db()).bookings.find((b) => b.guest_name === 'Late').confirmed_at, 'confirmed saved');
  step('LINE: message prepared with payment line, sent + confirmed recorded');

  // Returning guest recognised by phone; customer category with discount
  await page.click('#modal [data-action=close-modal]');
  await page.click('[data-action=new-booking]');
  await page.fill('#modal [name=phone]', '0811111111');
  await page.waitForSelector('#guest-hint .guest-hint b');
  assert.equal(await page.inputValue('#modal [name=guest_name]'), 'Late', 'name filled from guest');
  assert.ok(await page.locator('#modal [name=category_id][value=""]').isChecked(), 'category defaults to General');
  await page.click('#modal .chip-radio:has-text("เพื่อนหุ้นส่วน")');
  await page.selectOption('#modal [name=table_id]', 'T1');
  await page.selectOption('#modal [name=time]', '23:00');
  await page.fill('#modal [name=guest_name]', 'Partner');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  d = await db();
  const partner = d.bookings.find((b) => b.guest_name === 'Partner');
  assert.equal(partner.category_id, 'C1');
  assert.equal(partner.duration_min, 180, 'whole-night: 23:00 holds the table until 02:00');
  await page.click('.brow:has-text("Partner")');
  assert.match(await page.textContent('#modal .bk-head'), /เพื่อนหุ้นส่วน/);
  assert.match(await page.textContent('#modal .money'), /−330฿/);
  assert.match(await page.textContent('#modal .money'), /2,970฿/);
  await page.click('#modal [data-action=set-status][data-s=cancelled]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  step('returning guest recognised; category discount 10% shown; whole-night length');

  // Edit booking
  await page.click('.brow:has-text("Late")');
  await page.click('[data-action=edit-booking]');
  await page.fill('#modal [name=note]', 'วันเกิด');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  assert.equal((await db()).bookings.find((b) => b.guest_name === 'Late').note, 'วันเกิด');
  await shot('06-list');
  step('edit booking');

  // List filters and search
  await page.click('[data-action=filter][data-f=unpaid]');
  assert.equal(await page.locator('#list-rows .brow').count(), 1, 'only the booking with the unpaid package');
  assert.match(await page.textContent('#list-rows'), /Late/);
  await page.click('[data-action=filter][data-f=closed]');
  assert.equal(await page.locator('#list-rows .brow').count(), 3, 'done, no-show, cancelled');
  await page.click('[data-action=filter][data-f=all]');
  await page.fill('input.search', 'late');
  assert.equal(await page.locator('#list-rows .brow').count(), 1, 'search by name');
  await page.fill('input.search', '');
  step('list filter chips and search');

  // New booking form: defaults to now and a free table; taken tables are marked
  await go('map');
  await page.click('[data-action=new-booking].nb');
  assert.equal(await page.inputValue('#modal [name=time]'), '21:00', 'time defaults to now');
  const chosen = await page.inputValue('#modal [name=table_id]');
  const optText = await page.locator(`#modal [name=table_id] option[value="${chosen}"]`).textContent();
  assert.ok(!optText.includes('ไม่ว่าง'), `default table is free (${optText})`);
  assert.ok(await page.locator('#modal [name=table_id] option', { hasText: 'ไม่ว่าง' }).count() > 0, 'busy tables marked');
  await page.click('#modal [data-action=close-modal]');
  assert.equal(await page.getAttribute('svg.floor [data-tid=T1] .tier-dot', 'style'), 'fill:#D7261E', 'tier dot uses tier color');
  step('booking form defaults; tier dot colored');

  // Summary
  await go('summary');
  assert.deepEqual(await page.locator('.stats.money .stat .num').allTextContents(), ['3,300฿', '1,400฿'], 'paid / still owed');
  const nums = await page.locator('.stats:not(.money) .stat .num').allTextContents();
  assert.deepEqual(nums, ['4', '6', '1', '1', '1'], 'bookings, guests (4 done + 2 walk-in), walk-ins, cancelled, no-show');
  await shot('07-summary');
  step('nightly summary numbers');

  // Layout editor: view mode is read-only; edit mode keeps a draft with undo/redo until Save
  await go('layouts');
  const before = JSON.stringify((await db()).tables);
  const t1box = await page.locator('#editor-svg [data-tid="T1"]').boundingBox();
  await page.mouse.move(t1box.x + 10, t1box.y + 10); await page.mouse.down();
  await page.mouse.move(t1box.x + 120, t1box.y + 80, { steps: 4 }); await page.mouse.up();
  assert.equal(JSON.stringify((await db()).tables), before, 'dragging outside edit mode changes nothing');
  assert.ok(await page.locator('[data-action=table-add]').count() === 0, 'no add buttons outside edit mode');

  await page.click('[data-action=edit-start]');
  await page.click('[data-action=table-add]');
  await page.waitForSelector('form[data-form=table]');
  assert.equal((await db()).tables.length, JSON.parse(before).length, 'nothing saved before Save');
  const newId = await page.getAttribute('#editor-svg .tbl.sel', 'data-tid');
  assert.match(newId, /^new-/);
  const box = await page.locator(`#editor-svg [data-tid="${newId}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 600, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await page.fill('form[data-form=table] [name=label]', 'Bar 1');
  await page.fill('form[data-form=table] [name=seats]', '6');
  await page.selectOption('form[data-form=table] [name=shape]', 'round');
  await page.click('form[data-form=table] button[type=submit]');
  assert.equal(await page.inputValue('form[data-form=table] [name=label]'), 'Bar 1');
  await page.click('[data-action=undo]');
  assert.equal(await page.inputValue('form[data-form=table] [name=label]'), 'T4', 'undo restores previous name');
  await page.click('[data-action=redo]');
  assert.equal(await page.inputValue('form[data-form=table] [name=label]'), 'Bar 1', 'redo re-applies');
  await page.selectOption('[data-change=add-element]', 'speaker');
  await page.waitForSelector('#editor-svg .fx-speaker');
  await page.fill('form[data-form=room] [name=w]', '900');
  await page.click('form[data-form=room] button[type=submit]');
  await shot('08-layout-editor');
  await page.click('[data-action=edit-save]');
  await page.waitForSelector('[data-action=edit-start]');
  d = await db();
  const bar1 = d.tables.find((x) => x.label === 'Bar 1');
  assert.ok(bar1 && bar1.seats === 6 && bar1.shape === 'round', 'saved new table');
  assert.equal(bar1.x, 32, 'dragged past the wall -> sits flush against it');
  assert.equal(d.tables.filter((x) => x.kind === 'speaker').length, 1, 'saved speaker');
  assert.equal(d.layouts.find((l) => l.id === 'L1').rooms['1'].w, 900, 'room size saved');
  step('layout editor: read-only until Edit; draft, wall snap, undo/redo, room size, Save');

  // Cancel discards the draft
  await page.click('[data-action=edit-start]');
  const t2box = await page.locator('#editor-svg [data-tid="T2"]').boundingBox();
  await page.mouse.move(t2box.x + 10, t2box.y + 10); await page.mouse.down();
  await page.mouse.move(t2box.x + 90, t2box.y + 90, { steps: 4 }); await page.mouse.up();
  await page.click('[data-action=edit-cancel]');
  assert.equal((await db()).tables.find((x) => x.id === 'T2').x, 400, 'cancel keeps saved position');
  step('cancel discards unsaved moves');

  promptAnswer = 'Concert';
  await page.click('[data-action=layout-dup]');
  await page.waitForTimeout(100);
  d = await db();
  const concert = d.layouts.find((l) => l.name === 'Concert');
  assert.equal(d.tables.filter((x) => x.layout_id === concert.id).length, 6, 'all tables and elements copied');

  // Remove a table from Concert, then switch tonight to Concert -> mapping dialog
  const cT2 = d.tables.find((x) => x.layout_id === concert.id && x.label === 'T2');
  await page.selectOption('[data-change=edit-layout]', concert.id);
  await page.click('[data-action=edit-start]');
  await page.click(`#editor-svg [data-tid="${cT2.id}"]`);
  await page.click('[data-action=table-remove]');
  await page.click('[data-action=edit-save]');
  await page.waitForSelector('[data-action=edit-start]');
  assert.ok((await db()).tables.find((x) => x.id === cT2.id).archived);
  await go('map');
  await page.click('[data-action=pick-layout]');
  await page.click(`[data-action=choose-layout][data-id="${concert.id}"]`);
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
  await go('staff');
  await page.fill('form[data-form=staff] [name=display_name]', 'Mai');
  await page.fill('form[data-form=staff] [name=email]', 'mai@bar.test');
  await page.fill('form[data-form=staff] [name=password]', 'longpassword');
  await page.click('form[data-form=staff] button[type=submit]');
  await page.waitForSelector('.srow:has-text("Mai")');
  await shot('10-staff');
  await go('settings');
  assert.ok(await page.locator('form[data-form=settings] [name=default_duration_min]').isHidden(), 'no length to set in whole-night mode');
  await page.click('form[data-form=settings] .radio-card:has-text("กำหนดระยะเวลา")');
  await page.fill('form[data-form=settings] [name=default_duration_min]', '90');
  await page.click('form[data-form=settings] button[type=submit]');
  await page.waitForTimeout(100);
  assert.equal((await db()).settings[0].default_duration_min, 90);
  assert.equal((await db()).settings[0].booking_mode, 'timed');
  await go('map');
  assert.ok(await page.locator('#at-range').count(), 'time slider back in timed mode');
  await page.click('[data-action=new-booking].nb');
  assert.equal(await page.inputValue('#modal [name=duration_min]'), '90', 'length field in timed mode');
  await page.click('#modal [data-action=close-modal]');
  await go('settings');
  await page.click('form[data-form=settings] .radio-card:has-text("จองทั้งคืน")');
  await page.click('form[data-form=settings] button[type=submit]');
  await page.waitForTimeout(100);
  assert.equal((await db()).settings[0].booking_mode, 'night');
  // categories: managers add one with a discount
  const newCat = page.locator('form[data-form=category]').last();
  await newCat.locator('[name=name]').fill('ส่วนลดพนักงาน');
  await newCat.locator('[name=discount_pct]').fill('20');
  await newCat.locator('button[type=submit]').click();
  await page.waitForFunction(() => window.__db.categories.some((c) => c.name === 'ส่วนลดพนักงาน' && c.discount_pct === 20));
  step('add staff, booking-length mode on/off, customer categories');

  // Language
  await page.click('.bottomnav [data-action=more]');
  await page.click('.menu-item[data-action=lang]');
  assert.ok(await page.locator('.bn-item', { hasText: 'Floor map' }).count());
  await go('map');
  await shot('11-map-english');
  const thKeys = await page.evaluate(async () => {
    const m = await import('./i18n.js');
    const th = Object.keys(m.KEYS.th), en = Object.keys(m.KEYS.en);
    return { missingEn: th.filter((k) => !en.includes(k)), missingTh: en.filter((k) => !th.includes(k)) };
  });
  assert.deepEqual(thKeys, { missingEn: [], missingTh: [] });
  step('language switch to English, every label has both languages');

  // Staff role: no manager tabs
  await page.click('.bottomnav [data-action=more]');
  await page.click('.menu-item[data-action=logout]');
  await page.waitForSelector('form[data-form=login]');
  await page.fill('[name=email]', 'staff@bar.test');
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForSelector('svg.floor');
  await page.click('.bottomnav [data-action=more]');
  assert.deepEqual(await page.locator('.menu-item[data-action=view]').evaluateAll((els) => els.map((e) => e.dataset.v)), ['concert'], 'only the concert report, no manager pages');
  await page.click('#modal [data-action=close-modal]');
  assert.equal(await page.locator('[data-action=pick-layout]').count(), 0, 'staff cannot switch the layout');
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
