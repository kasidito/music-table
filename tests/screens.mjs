// Capture every screen and state for UX review. Usage: node tests/screens.mjs <out dir> <width> <height>
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fontCss, serveFont } from './fonts.mjs';

const ROOT = path.resolve(import.meta.dirname, '../app');
const OUT = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 390), H = Number(process.argv[4] ?? 844);
const mig = (f) => fs.readFileSync(path.resolve(import.meta.dirname, '../supabase/migrations', f), 'utf8');
const ROW = /\((\d), '(\w+)', +'(\w+)', +(\d+), '(\w+)', +(\d+), +(\d+), +(\d+), +(\d+)(?:, (null(?:::text)?|'#\w+'), (null(?:::int)?|\d+))?\)/g;
const parse = (sql, layout, prefix) => [...sql.matchAll(ROW)].map(([, floor, kind, label, seats, shape, x, y, w, h, color, price], i) => ({
  id: `${prefix}${i}`, layout_id: layout, floor: +floor, kind, label, seats: +seats, shape, x: +x, y: +y, w: +w, h: +h, archived: false,
  color: color && color !== 'null' && !color.startsWith('null') ? color.replace(/'/g, '') : null,
  price: price && !price.startsWith('null') ? +price : null,
}));
const normal = parse(mig('003_preset_floor_layouts.sql'), 'L1', 'N');
const purpeech = parse(mig('007_concert_layouts.sql').split('-- ── Greasy Cafe')[0], 'L2', 'P');
purpeech.forEach((x) => { if (x.kind === 'table') x.set_note = x.seats >= 8 ? 'Monkey 2 ขวด' : 'Monkey 1 ขวด'; });
const id = (rows, label, floor = 1) => rows.find((r) => r.label === label && r.floor === floor).id;
const at = (hhmm, day = 22) => new Date(`2026-10-${hhmm < '06' ? day + 1 : day}T${hhmm}:00+07:00`).toISOString();
const mk = (i, night, table, t, status, name, ppl, extra = {}) => ({
  id: 'B' + i, table_id: table, night, start_at: at(t, +night.slice(8)), duration_min: 120, party_size: ppl, guest_name: name,
  phone: name ? '0812345678' : '', note: '', status, is_walk_in: !name, created_by: 'U1', updated_by: 'U1',
  paid: false, paid_at: null, paid_by: null, slip_path: null, pay_status: 'unpaid', category_id: null, sold_price: null, wristband_at: null, amount_paid: 0, extra_table_ids: [], ...extra,
});
const bookings = [
  mk(1, '2026-10-22', id(normal, 'T12'), '20:30', 'seated', 'สมชาย', 4),
  mk(2, '2026-10-22', id(normal, 'T5'), '21:30', 'booked', 'Mia', 2, { note: 'วันเกิด', category_id: 'C2' }),
  mk(3, '2026-10-22', id(normal, 'S2'), '22:30', 'booked', 'นภา', 2),
  mk(4, '2026-10-22', id(normal, 'B3'), '19:00', 'seated', '', 2),
  mk(5, '2026-10-22', id(normal, 'T9'), '21:00', 'seated', 'Ken', 3),
  mk(6, '2026-10-22', id(normal, 'W1'), '23:00', 'booked', 'ปิยะ', 4),
  mk(7, '2026-10-22', id(normal, 'T2'), '20:00', 'done', 'Tom', 4),
  mk(8, '2026-10-22', id(normal, 'UP8', 2), '21:00', 'seated', 'Yuki', 6),
  mk(9, '2026-10-24', id(purpeech, 'A1'), '20:00', 'booked', 'Fan club', 5, { paid: true, pay_status: 'paid', paid_at: at('15:00', 24), paid_by: 'U1', wristband_at: at('19:40', 24), wristband_by: 'U1' }),
  mk(10, '2026-10-24', id(purpeech, 'A5'), '20:00', 'booked', 'Ploy', 5, { pay_status: 'waiting', category_id: 'C1', note: 'ซื้อต่อจากชาช่า' }),
  mk(11, '2026-10-24', id(purpeech, 'B2', 2), '20:00', 'booked', 'Office party', 8, { pay_status: 'at_venue' }),
];
const fake = fs.readFileSync(path.resolve(import.meta.dirname, 'fake-supabase.js'), 'utf8') + `;
window.__db.layouts = [
  { id: 'L1', name: 'Normal', is_default: true, created_at: '2026-01-01', rooms: { 1: { w: 730, h: 629 }, 2: { w: 846, h: 378 } } },
  { id: 'L2', name: 'Purpeech', is_default: false, created_at: '2026-01-02', rooms: { 1: { w: 709, h: 504 }, 2: { w: 418, h: 602 } } },
];
window.__db.day_layouts = [{ night: '2026-10-24', layout_id: 'L2' }];
window.__db.tables = ${JSON.stringify([...normal, ...purpeech])};
window.__db.bookings = ${JSON.stringify(bookings)};`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  if (serveFont(req, res)) return;
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/vendor/supabase.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fake); }
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
}).listen(0);

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.setDefaultTimeout(5000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.dismiss());
await page.clock.setFixedTime(new Date('2026-10-22T22:00:00+07:00'));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fontCss(`http://127.0.0.1:${server.address().port}`) }));
const shot = async (n, full = false) => page.screenshot({ path: path.join(OUT, `${W}-${n}.png`), fullPage: full });
const phone = W < 768;
const nav = async (v) => {
  if (phone && !['map', 'list', 'summary'].includes(v)) { await page.click('.bottomnav [data-action=more]'); await page.click(`.menu-item[data-v="${v}"]`); }
  else await page.click(`${phone ? '.bottomnav' : '.rail'} [data-v="${v}"]`);
  await page.waitForTimeout(120);
};
// Whole sheet, not just what fits on screen.
const sheetShot = async (n) => {
  await page.evaluate(() => { const m = document.querySelector('#modal'); m.style.position = 'absolute'; m.style.alignItems = 'flex-start'; const sh = m.querySelector('.sheet'); if (sh) sh.style.maxHeight = 'none'; });
  await shot(n, true);
};
const close = () => page.click('#modal [data-action=close-modal]').catch(() => {});

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await shot('01-login');
await page.fill('[name=email]', 'boss@bar.test');
await page.fill('[name=password]', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('svg.floor');
await shot('02-map');
await page.click(`svg.floor [data-tid="${id(normal, 'T5')}"]`); await page.waitForTimeout(150);
await shot('03-table-tap'); await close();
await page.click('[data-action=new-booking].nb'); await page.waitForSelector('form[data-form=booking]');
await sheetShot('04-new-booking'); await close();
await page.click('[data-action=open-booking] >> nth=0').catch(() => {});
await page.waitForTimeout(250); await sheetShot('05-booking-detail'); await close();
if (phone) { await page.click('.bottomnav [data-action=more]'); await shot('06-more'); await close(); }
await nav('list'); await shot('07-list', true);
await nav('summary'); await shot('08-summary');
await nav('map');
await page.click('.datestrip [data-d="2026-10-24"]'); await page.waitForTimeout(150);
await shot('09-concert-f1');
await page.click('[data-action=floor][data-f="2"]'); await shot('10-concert-f2');
await page.click('[data-action=floor][data-f="1"]');
await page.click(`svg.floor [data-tid="${id(purpeech, 'A5')}"]`); await page.waitForTimeout(150);
await page.click('#modal [data-action=open-booking] >> nth=0').catch(() => {}); await page.waitForTimeout(250);
await sheetShot('11-unpaid-detail'); await close();
await page.click('.nb[data-v=concert]'); await page.waitForSelector('.xsheet'); await shot('16-concert-report', true);
await nav('map');
await page.click('[data-action=new-booking].nb'); await page.waitForSelector('form[data-form=booking]'); await sheetShot('17-new-concert-booking'); await close();
await nav('layouts'); await shot('12-layouts-view');
await page.click('[data-action=edit-start]'); await page.click(`#editor-svg [data-tid="${id(normal, 'T14')}"]`).catch(() => {});
await page.waitForTimeout(120); await shot('13-layouts-edit', true);
await page.click('[data-action=edit-cancel]');
await nav('staff'); await shot('14-staff');
await nav('settings'); await shot('15-settings');
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
