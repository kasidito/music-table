// iPad-size UI test with the real floor preset: side panel, quick actions, time slider, every page.
// Usage: node tests/ipad.test.mjs <screenshot dir>
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '../app');
const SHOTS = process.argv[2] ?? '.';
const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../supabase/migrations/003_preset_floor_layouts.sql'), 'utf8');
const rows = [...sql.matchAll(/\((\d), '(\w+)', +'(\w+)', +(\d+), '(\w+)', +(\d+), +(\d+), +(\d+), +(\d+)\)/g)]
  .map(([, floor, kind, label, seats, shape, x, y, w, h]) => ({
    id: 'P_' + label, layout_id: 'L1', floor: +floor, kind, label, seats: +seats, shape, x: +x, y: +y, w: +w, h: +h, archived: false,
  }));
const iso = (s) => new Date(s).toISOString();
const bookings = [
  { id: 'B1', table_id: 'P_T5', start_at: iso('2026-10-22T21:30:00+07:00'), status: 'booked', guest_name: 'Mia', phone: '081', party_size: 2 },
  { id: 'B2', table_id: 'P_S2', start_at: iso('2026-10-22T22:30:00+07:00'), status: 'booked', guest_name: 'นภา', phone: '082', party_size: 2 },
  { id: 'B3', table_id: 'P_UP3', start_at: iso('2026-10-22T20:00:00+07:00'), status: 'seated', guest_name: 'Ken', phone: '083', party_size: 4 },
].map((b) => ({ night: '2026-10-22', duration_min: 120, note: '', is_walk_in: false, created_by: 'U1', updated_by: 'U1', ...b }));
const fake = fs.readFileSync(path.resolve(import.meta.dirname, 'fake-supabase.js'), 'utf8') +
  `;window.__db.tables = ${JSON.stringify(rows)}; window.__db.bookings = ${JSON.stringify(bookings)};`;

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
const errors = [];
const step = (n) => console.log('ok -', n);
try {
  for (const [w, h] of [[1180, 820], [820, 1180]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.clock.setFixedTime(new Date('2026-10-22T22:00:00+07:00'));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.fill('[name=email]', 'boss@bar.test');
    await page.fill('[name=password]', 'password123');
    await page.click('button[type=submit]');
    await page.waitForSelector('svg.floor');

    assert.ok(await page.locator('.rail').isVisible(), 'rail visible');
    assert.ok(!(await page.locator('.bottomnav').isVisible()), 'no bottom nav on iPad');
    const box = await page.locator('svg.floor').boundingBox();
    assert.ok(box.y + box.height <= h, `whole floor visible without scrolling (${Math.round(box.y + box.height)} <= ${h})`);
    assert.match(await page.textContent('.stats-row'), /1\s*มาช้า/);
    step(`${w}x${h}: rail, whole floor on screen, late count`);

    const landscape = w >= 1024;
    await page.click('svg.floor [data-tid="P_T5"]');
    if (landscape) {
      // Tap a table: details in the side panel, not a pop-up
      await page.waitForSelector('.side .sel-card');
      assert.ok(await page.locator('#modal').isHidden());
      assert.match(await page.textContent('.side .sel-card'), /Mia/);
    } else {
      await page.waitForSelector('#modal .sheet');
      assert.match(await page.textContent('#modal'), /Mia/);
      await page.click('#modal [data-action=close-modal]');
    }
    await page.screenshot({ path: path.join(SHOTS, `ipad-${w}-selected.png`) });
    step(`${w}x${h}: table details open (${landscape ? 'side panel' : 'sheet'})`);

    // Quick "arrived" from the queue seats the late booking
    await page.click(`${landscape ? '.side' : '.upcoming'} .up-row.late [data-action=set-status]`);
    await page.waitForFunction(() => window.__db.bookings.find((b) => b.id === 'B1').status === 'seated');
    await page.waitForSelector('svg.floor [data-tid="P_T5"].st-seated');
    step(`${w}x${h}: one tap "arrived" seats guests and updates map`);

    // Time slider redraws the map without re-rendering the page
    const range = page.locator('#at-range');
    await range.evaluate((el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.textContent('#at-label'), '18:00');
    assert.ok((await page.getAttribute('svg.floor [data-tid="P_S2"]', 'class')).includes('st-free'));
    step(`${w}x${h}: time slider shows the floor at 18:00`);

    // Date strip
    await page.click('.datestrip [data-d="2026-10-24"]');
    assert.match(await page.textContent('.night-title'), /24/);
    await page.click('.datestrip [data-d="2026-10-22"]');

    // Floor 2 and every page through the rail
    await page.click('[data-action=floor][data-f="2"]');
    assert.ok(await page.locator('svg.floor [data-tid="P_UP3"]').count());
    for (const v of ['list', 'summary', 'layouts', 'staff', 'settings', 'map']) {
      await page.click(`.rail [data-v="${v}"]`);
      await page.waitForTimeout(80);
      assert.ok(await page.locator(`.rail [data-v="${v}"].on`).count(), v);
    }
    step(`${w}x${h}: date strip, floor 2, all pages via rail`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('ALL IPAD TESTS PASSED');
} catch (e) {
  console.error('FAILED:', e.message, '\nbrowser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
