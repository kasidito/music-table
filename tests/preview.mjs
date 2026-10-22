// Screenshot the app with the real floor preset and mock bookings (no network).
// Usage: node tests/preview.mjs <out dir> [width] [height]
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../app');
const OUT = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 390), H = Number(process.argv[4] ?? 844);

// Read the preset rows from the migration so the preview always matches the database.
const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../supabase/migrations/003_preset_floor_layouts.sql'), 'utf8');
const rows = [...sql.matchAll(/\((\d), '(\w+)', +'(\w+)', +(\d+), '(\w+)', +(\d+), +(\d+), +(\d+), +(\d+)\)/g)]
  .map(([, floor, kind, label, seats, shape, x, y, w, h], i) => ({
    id: 'P' + i, layout_id: 'L1', floor: +floor, kind, label, seats: +seats, shape, x: +x, y: +y, w: +w, h: +h, archived: false,
  }));
const at = (hhmm, day = 22) => new Date(`2026-10-${hhmm < '06' ? day + 1 : day}T${hhmm}:00+07:00`).toISOString();
const pick = (label) => rows.find((r) => r.label === label).id;
const bookings = [
  ['T12', '20:30', 'seated', 'สมชาย', 4], ['T5', '21:30', 'booked', 'Mia', 2], ['S2', '22:00', 'booked', 'นภา', 2],
  ['B3', '19:00', 'seated', '', 2, true], ['T9', '21:00', 'seated', 'Ken', 3], ['W1', '23:00', 'booked', 'ปิยะ', 4],
  ['T2', '20:00', 'done', 'Tom', 4], ['T7', '21:45', 'booked', 'Yuki', 4],
].map(([label, t, status, name, ppl, walk], i) => ({
  id: 'B' + i, table_id: pick(label), night: '2026-10-22', start_at: at(t), duration_min: 120, party_size: ppl,
  guest_name: name, phone: name ? '0812345678' : '', note: '', status, is_walk_in: !!walk, created_by: 'U1', updated_by: 'U1',
}));
const override = `;window.__db.tables = ${JSON.stringify(rows)}; window.__db.bookings = ${JSON.stringify(bookings)};`;
const fake = fs.readFileSync(path.resolve(import.meta.dirname, 'fake-supabase.js'), 'utf8') + override;

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
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.clock.setFixedTime(new Date('2026-10-22T22:00:00+07:00'));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.fill('[name=email]', 'boss@bar.test');
await page.fill('[name=password]', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('svg.floor');
await page.screenshot({ path: path.join(OUT, `map-f1-${W}.png`) });
await page.click('[data-action=floor][data-f="2"]');
await page.screenshot({ path: path.join(OUT, `map-f2-${W}.png`) });
await browser.close(); server.close();
console.log('saved', rows.length, 'items');
