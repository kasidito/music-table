import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { t, getLang, setLang } from './i18n.js';
import * as T from './time.js';
import { log, configure as configureLog, installGlobalHandlers, recent as recentLogs, setDebug, isDebug, flush as flushLogs } from './log.js';
import { dueOf, paidOf, tableIdsOf, listPriceOf, netPriceOf, receivedOf, stillOwes, PAY_STATUSES } from './money.js';
import { fill, paymentLine, lineShareUrl } from './share.js';
import { summarizeRange, toCSV, concertRows, freeTables, cashUp } from './reports.js';
import { concertWorkbook, loadExcelJS } from './concert-xlsx.js';
import { VERSION } from './version.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Payment status icons (one per bookings.pay_status).
const PAY_ICON = {
  unpaid: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  waiting: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  deposit: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  paid: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  at_venue: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
};

const ICON = {
  left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
  walk: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13" cy="4" r="2"/><path d="M7 21l3-7 3 3v5M10 14l1-5 4 3 3 1M9 9l2-1"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><circle cx="6.5" cy="17.5" r="3.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>',
  trend: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  wristband: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 8v8M16 8v8"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>',
  plusB: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
};

// ───────── State ─────────
const S = {
  user: null, me: null,
  settings: null, layouts: [], tables: [], profiles: [],
  night: null, dayLayout: null, bookings: [],
  view: 'map', floor: 1, at: 'now',
  editLayoutId: null, editFloor: 1, selTable: null,
};

const isManager = () => S.me?.active && S.me.role === 'manager';
const defaultLayoutId = () => S.layouts.find((l) => l.is_default)?.id;
const nightLayoutId = () => S.dayLayout?.layout_id ?? defaultLayoutId();
const layoutName = (id) => S.layouts.find((l) => l.id === id)?.name ?? '';
const tableById = (id) => S.tables.find((x) => x.id === id);
const isTable = (x) => (x.kind ?? 'table') === 'table';
const itemsOf = (layoutId, floor) =>
  S.tables.filter((x) => x.layout_id === layoutId && !x.archived && (!floor || x.floor === floor));
const tablesOf = (layoutId, floor) =>
  itemsOf(layoutId, floor).filter(isTable)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
const personName = (id) => S.profiles.find((p) => p.id === id)?.display_name ?? '—';
const isTonight = () => S.night === T.nightOf(Date.now(), S.settings);
const hhmm = (iso) => T.bkkParts(Date.parse(iso)).hhmm;
const fmtNight = (d) => { const p = dayParts(d); return `${p.wd} ${p.day} ${p.mon}`; };
const baht = (n) => `${Number(n || 0).toLocaleString('en-US')}฿`;
// Money for a booking, from its tables, items and payment rows.
const categoryById = (id) => (id ? (S.categories ?? []).find((c) => c.id === id) ?? null : null);
const wholeNight = () => S.settings?.booking_mode !== 'timed';
const TOPTS = () => ({ wholeNight: wholeNight() });
const dueOfB = (b) => dueOf(b, tableById, b.booking_items ?? [], categoryById(b.category_id));
const paidOfB = (b) => paidOf(b.booking_payments ?? []);
const receivedOfB = (b) => receivedOf(b.pay_status, dueOfB(b), paidOfB(b));
const payOf = (b) => b.pay_status ?? 'unpaid';
const isOpen = (b) => b.status !== 'cancelled' && b.status !== 'no_show';
// Payment matters when the table has a price, something was charged, or staff set a status.
const tracksPayment = (b) => dueOfB(b) > 0 || payOf(b) !== 'unpaid' || paidOfB(b) > 0;
// Still owes money: not marked paid and less recorded than due.
const owes = (b) => isOpen(b) && stillOwes(payOf(b)) && dueOfB(b) > paidOfB(b);
const needsPayment = (b) => isOpen(b) && dueOfB(b) > 0;
function payPill(b) {
  if (!tracksPayment(b) || (!isOpen(b) && payOf(b) !== 'paid')) return '';
  const st = payOf(b);
  return `<span class="pill ps ps-${st}">${PAY_ICON[st]}${t('ps_' + st)}</span>`;
}
const catChip = (b) => { const c = categoryById(b.category_id); return c ? `<span class="cat-chip" style="--c:${esc(c.color)}">${esc(c.name)}</span>` : ''; };
// Concert night = tonight's layout sells tables (has prices).
const isConcertLayout = (lid) => tablesOf(lid).some((x) => x.price != null);
const tablesLabel = (b) => tableIdsOf(b).map((id) => tableById(id)?.label ?? '?').join('+');
const tableLabel = (id) => { const x = tableById(id); return x ? `${x.label} · ${t('floor')} ${x.floor}` : '—'; };

function atMs() {
  if (S.at === 'now' && isTonight()) return Date.now();
  const at = S.at === 'now' ? S.settings.open_time.slice(0, 5) : S.at;
  return T.nightTimeToMs(S.night, at, S.settings);
}

const ERRORS = [
  'table_has_future_bookings', 'need_one_manager', 'unmapped_bookings', 'cannot_delete_default_layout',
  'invalid_status_change', 'table_not_in_night_layout', 'table_archived', 'forbidden',
  'guest_name_required', 'phone_required', 'password_too_short', 'invalid_email', 'invalid_extra_tables', 'not_a_table',
  'excel_load_failed',
];
function errMsg(e) {
  const m = e?.message ?? String(e);
  const code = ERRORS.find((c) => m.includes(c));
  if (code) return t('err_' + code);
  if (e?.code === '23503') return t('err_in_use');
  if (m.includes('Invalid login')) return t('err_login');
  return m;
}
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3500);
}
// Await a Supabase call; on failure log it (with what was attempted) and throw.
async function run(promise, what = 'db') {
  const { data, error } = await promise;
  if (error) {
    const known = ERRORS.some((c) => error.message?.includes(c));
    log[known ? 'warn' : 'error'](`db.${what}`, { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw error;
  }
  return data;
}

// ───────── Data ─────────
async function loadBase() {
  const [s, l, tb, p, pr, cats] = await Promise.all([
    run(sb.from('settings').select('*').single(), 'load.settings'),
    run(sb.from('layouts').select('*').order('created_at'), 'load.layouts'),
    run(sb.from('tables').select('*'), 'load.tables'),
    run(sb.from('profiles').select('*').order('created_at'), 'load.profiles'),
    run(sb.from('products').select('*').order('created_at'), 'load.products'),
    run(sb.from('categories').select('*').order('sort').order('created_at'), 'load.categories'),
  ]);
  S.settings = s; S.layouts = l; S.profiles = p; S.products = pr; S.categories = cats;
  S.tables = tb.map((x) => ({ ...x, x: Number(x.x), y: Number(x.y) }));
  if (!S.layouts.some((x) => x.id === S.editLayoutId)) S.editLayoutId = null;
}
async function loadNight() {
  const [d, b] = await Promise.all([
    run(sb.from('day_layouts').select('*').eq('night', S.night).maybeSingle(), 'load.day_layout'),
    run(sb.from('bookings').select(BOOKING_SELECT).eq('night', S.night).order('start_at'), 'load.bookings'),
  ]);
  S.dayLayout = d; S.bookings = b;
  await loadReminders();
}
const BOOKING_SELECT = '*, booking_payments(*), booking_items(*), guest:guests(*)';

// Bookings for tonight and tomorrow that still need a reminder sent.
async function loadReminders() {
  const tonight = T.nightOf(Date.now(), S.settings);
  try {
    S.toRemind = await run(sb.from('bookings').select('id, night, start_at, guest_name, table_id, phone')
      .in('night', [tonight, T.addDays(tonight, 1)]).eq('status', 'booked').is('reminded_at', null).is('confirmed_at', null)
      .order('start_at'), 'load.reminders');
  } catch { S.toRemind = []; }
}
async function reload() { await loadBase(); await loadNight(); render(); }

let channel = null, reloadTimer = null;
function setupRealtime() {
  if (channel) return;
  channel = sb.channel('db');
  for (const table of ['bookings', 'tables', 'layouts', 'day_layouts', 'settings', 'booking_payments', 'booking_items', 'guests', 'products', 'categories']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      if (table === 'bookings') notifyFromChange(payload);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        await loadBase(); await loadNight();
        const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && $('#app').contains(document.activeElement);
        if (!drag && !typing && !$('#modal:not([hidden])')) render();
        refreshOpenBooking();
      }, 300);
    });
  }
  channel.subscribe((status, err) => {
    S.realtime = status;
    if (status === 'SUBSCRIBED') log.info('realtime.subscribed');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') log.warn('realtime.problem', { status, error: err });
  });
}
function teardownRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

// ───────── Boot ─────────
async function boot() {
  try {
    if (!S.user) { teardownRealtime(); S.me = null; return render(); }
    S.me = await run(sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle(), 'load.me');
    if (!S.me?.active) { log.warn('auth.inactive_account'); return render(); }
    configureLog({ send: async (rows) => { const { error } = await sb.from('app_logs').insert(rows); if (error) throw error; } });
    log.info('auth.ready', { role: S.me.role });
    await loadBase();
    if (!S.night) S.night = T.nightOf(Date.now(), S.settings);
    await loadNight();
    setupRealtime();
    render();
  } catch (e) { log.error('boot.failed', e); toast(errMsg(e), true); render(); }
}

async function init() {
  installGlobalHandlers();
  configureLog({ version: VERSION });
  log.info('app.start', { version: VERSION, debug: isDebug() });
  document.documentElement.lang = getLang();
  window.addEventListener('online', () => { log.info('net.online'); toast(t('back_online')); });
  window.addEventListener('offline', () => { log.warn('net.offline'); toast(t('offline'), true); });
  setInterval(tick, 60000);
  setInterval(checkForUpdate, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user ?? null;
  sb.auth.onAuthStateChange((_e, session) => {
    const u = session?.user ?? null;
    if (u?.id !== S.user?.id) { S.user = u; setTimeout(boot, 0); }
  });
  await boot();
}

// A newer deploy is out: offer a one-tap reload (phones keep old files open for hours).
async function checkForUpdate() {
  if (VERSION === 'dev' || $('#update-bar')) return;
  try {
    const text = await (await fetch(`version.js?t=${Date.now()}`, { cache: 'no-store' })).text();
    const live = text.match(/VERSION = '([^']+)'/)?.[1];
    if (live && live !== VERSION) {
      log.info('app.update_available', { from: VERSION, to: live });
      document.body.insertAdjacentHTML('beforeend', `<button id="update-bar" class="update-bar" data-action="reload">${t('update_ready')}</button>`);
    }
  } catch { /* offline: try again later */ }
}

// ───────── Views ─────────
function render() {
  const app = $('#app');
  if (!S.user) { app.innerHTML = viewLogin(); return; }
  if (!S.me) { app.innerHTML = `<div class="center muted">${t('loading')}</div>`; return; }
  if (!S.me.active) { app.innerHTML = viewInactive(); return; }
  if (!S.settings) { app.innerHTML = `<div class="center muted">${t('loading')}</div>`; return; }
  const body = {
    map: viewMap, list: viewList, summary: viewSummary,
    layouts: viewLayouts, staff: viewStaff, settings: viewSettings, reports: viewReports, concert: viewConcert, door: viewDoor,
  }[S.view]();
  app.innerHTML = `<div class="shell">${viewRail()}<div class="col">${viewTop()}<main>${body}</main></div>${
    S.view === 'map' ? `<aside class="side" aria-label="${t('tonight')}">${viewAside()}</aside>` : ''}</div>${viewBottomNav()}`;
  fitFloors();
}

// Make each floor drawing fill the space left on screen, so the whole floor shows without scrolling.
function fitFloors() {
  for (const svg of document.querySelectorAll('#app svg.floor')) {
    const below = (svg.id === 'editor-svg' ? 16 : 52) + (hasBottomNav() ? 96 : 0);
    const room = Math.max(240, window.innerHeight - svg.getBoundingClientRect().top - window.scrollY - below);
    const vb = svg.viewBox.baseVal, maxW = svg.parentElement.clientWidth;
    const h = Math.min(room, (maxW * vb.height) / vb.width);
    svg.style.height = h + 'px';
    svg.style.width = Math.min(maxW, (h * vb.width) / vb.height) + 'px';
  }
}
window.addEventListener('resize', () => fitFloors());

const langBtn = () => `<button class="ghost small" data-action="lang">${getLang() === 'th' ? 'EN' : 'ไทย'}</button>`;

const brandLockup = (cls = '') => `<div class="brand ${cls}"><img src="brand/lockup.png" alt="Perfect Strangers" width="330" height="60"><span class="brand-sub">${t('brand_sub')}</span></div>`;

function viewLogin() {
  return `<div class="login">
    <div class="login-glow" aria-hidden="true"></div>
    <div class="login-card">
      <div class="login-top">${langBtn()}</div>
      ${brandLockup('lg')}
      <p class="muted">${t('login_hint')}</p>
      <form data-form="login" class="stack">
        <label>${t('email')}<input name="email" type="email" autocomplete="username" required></label>
        <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">${t('login')}</button>
      </form>
    </div>
  </div>`;
}

function viewInactive() {
  return `<div class="login"><div class="login-glow" aria-hidden="true"></div><div class="login-card">
    ${brandLockup('lg')}
    <p>${t('inactive')}</p>
    <button data-action="logout">${t('logout')}</button>
  </div></div>`;
}

const wide = () => window.matchMedia('(min-width: 1024px)').matches;
const hasBottomNav = () => !window.matchMedia('(min-width: 768px)').matches;
const NIGHT_VIEWS = ['map', 'list', 'summary', 'concert', 'door'];
function navItems() {
  const items = [['map', 'tab_map', ICON.map], ['list', 'tab_list', ICON.list], ['summary', 'tab_summary', ICON.chart], ['concert', 'tab_concert', ICON.ticket], ['door', 'tab_door', ICON.wristband]];
  if (isManager()) items.push(['reports', 'tab_reports', ICON.trend], ['layouts', 'tab_layouts', ICON.edit], ['staff', 'tab_staff', ICON.people], ['settings', 'tab_settings', ICON.gear]);
  return items;
}
const navBtn = (v, k, ic, cls) =>
  `<button class="${cls} ${S.view === v ? 'on' : ''}" data-action="view" data-v="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${ic}<span>${t(k)}</span></button>`;

function viewRail() {
  return `<nav class="rail" aria-label="${t('menu')}">
    <div class="rail-logo"><img src="brand/mark.png" alt="Perfect Strangers" width="44" height="44"></div>
    ${navItems().map(([v, k, ic]) => navBtn(v, k, ic, 'rail-item')).join('')}
    <div class="grow"></div>
    ${bellButton('rail-item')}
    <button class="rail-item" data-action="lang"><span class="lang-mark">${getLang() === 'th' ? 'EN' : 'TH'}</span><span>${t('language')}</span></button>
    <button class="rail-item" data-action="logout">${ICON.logout}<span>${t('logout')}</span></button>
  </nav>`;
}

function viewBottomNav() {
  const moreOn = !NIGHT_VIEWS.includes(S.view);
  return `<nav class="bottomnav" aria-label="${t('menu')}">
    ${navItems().slice(0, 3).map(([v, k, ic]) => navBtn(v, k, ic, 'bn-item')).join('')}
    <button class="bn-item ${moreOn ? 'on' : ''}" data-action="more">${ICON.more}<span>${t('more')}</span></button>
  </nav>`;
}

const WEEKDAYS = { th: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const MONTHS = { th: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
const dayParts = (date) => { const d = new Date(date + 'T00:00:00Z'); return { wd: WEEKDAYS[getLang()][d.getUTCDay()], day: d.getUTCDate(), mon: MONTHS[getLang()][d.getUTCMonth()] }; };

function dateStrip() {
  const tonight = T.nightOf(Date.now(), S.settings);
  const days = [0, 1, 2, 3].map((n) => T.addDays(tonight, n));
  if (!days.includes(S.night)) days[3] = S.night;
  return `<div class="datestrip" role="group" aria-label="${t('night')}">
    ${days.map((d) => { const p = dayParts(d); return `<button class="day ${d === S.night ? 'on' : ''}" data-action="go-night" data-d="${d}" aria-pressed="${d === S.night}">
      <span class="wd">${d === tonight ? t('tonight') : p.wd}</span><span class="dn">${p.day}</span><span class="mo">${p.mon}</span></button>`; }).join('')}
    <label class="day cal" aria-label="${t('pick_date')}">${ICON.cal}<input type="date" value="${S.night}" data-change="night"></label>
  </div>`;
}

function statsRow() {
  const now = Date.now();
  const total = tablesOf(nightLayoutId()).length;
  const seated = S.bookings.filter((b) => b.status === 'seated').length;
  const late = isTonight() ? S.bookings.filter((b) => T.isLate(b, now)).length : 0;
  const unpaid = S.bookings.filter(owes).length;
  return `<div class="stats-row">
    <span class="chip"><b>${T.tablesBooked(S.bookings)}</b>/${total} ${t('tables_booked')}</span>
    <span class="chip"><b class="c-seated">${seated}</b> ${t('seated_now')}</span>
    ${late ? `<span class="chip late"><b>${late}</b> ${t('late')}</span>` : ''}
    ${unpaid ? `<button class="chip unpaid" data-action="view" data-v="list"><b>${unpaid}</b> ${t('unpaid')}</button>` : ''}
  </div>`;
}

function viewTop() {
  const night = NIGHT_VIEWS.includes(S.view);
  const p = dayParts(S.night);
  const lid = nightLayoutId();
  const layoutChip = `<button class="layout-chip ${isConcertLayout(lid) ? 'concert' : ''}" data-action="${isManager() ? 'pick-layout' : 'noop'}" ${isManager() ? '' : 'disabled'} aria-label="${t('night_layout')}">
      ${isConcertLayout(lid) ? ICON.ticket : ICON.map}<span><small>${t('tonight_layout')}</small>${esc(layoutName(lid))}</span>${isManager() ? ICON.chev : ''}</button>`;
  if (!night) return `<header class="topbar"><div class="row between"><h1 class="page-title">${t('tab_' + S.view)}</h1>${bellButton('phone-bell')}</div></header>`;
  return `<header class="topbar">
    <div class="row between top-row">
      <div class="top-brand"><img class="top-mark" src="brand/mark.png" alt="" width="28" height="28"><div><div class="eyebrow">PERFECT STRANGERS</div><div class="night-title">${p.wd} ${p.day} ${p.mon}${isTonight() ? ` <span class="tag">${t('tonight')}</span>` : ''}</div></div></div>
      <div class="row">${layoutChip}${bellButton('phone-bell')}</div>
    </div>
    ${dateStrip()}
    ${statsRow()}
  </header>`;
}

function moreSheet() {
  openModal(`<h2>${esc(S.me.display_name)}</h2>
    <div class="menu-list">
      ${navItems().slice(3).map(([v, k, ic]) => `<button class="menu-item" data-action="view" data-v="${v}">${ic}<span>${t(k)}</span></button>`).join('')}
      <button class="menu-item" data-action="lang"><span class="lang-mark">${getLang() === 'th' ? 'EN' : 'TH'}</span><span>${t('language')}: ${getLang() === 'th' ? 'ไทย' : 'English'}</span></button>
      <button class="menu-item" data-action="logout">${ICON.logout}<span>${t('logout')}</span></button>
    </div>`);
}

// Shared table drawing for the floor map and the layout editor.
const sizeOf = (tb) => ({ w: Number(tb.w) || 64, h: Number(tb.h) || 64 });
function tableSvg(tb, cls, lines) {
  const { w, h } = sizeOf(tb);
  const shape = tb.shape === 'round'
    ? `<ellipse cx="${tb.x}" cy="${tb.y}" rx="${w / 2 - 1}" ry="${h / 2 - 1}"/>`
    : `<rect x="${tb.x - w / 2 + 1}" y="${tb.y - h / 2 + 1}" width="${w - 2}" height="${h - 2}" rx="${isTable(tb) ? 6 : ['door', 'wall'].includes(tb.kind) ? 3 : 20}"/>`;
  const fs = Math.max(12, Math.min(18, Math.min(w, h) * 0.3));
  const shown = isTable(tb) ? lines : (['door', 'wall', 'speaker'].includes(tb.kind) ? [] : [tb.label]);
  const text = shown.filter(Boolean).map((l, i, a) => {
    const size = Math.min(i === 0 ? fs : fs * 0.72, ((w - 8) / Math.max(1, String(l).length)) * 1.6);
    return `<text x="${tb.x}" y="${tb.y + (i - (a.length - 1) / 2) * fs * 1.15}" class="${i === 0 ? 'tl' : 'ts'}" font-size="${Math.max(8, size).toFixed(1)}">${esc(l)}</text>`;
  }).join('');
  const kind = isTable(tb) ? 'tbl' : `tbl fx fx-${tb.kind}`;
  let extra = tb.kind === 'speaker' ? `<circle cx="${tb.x}" cy="${tb.y}" r="${Math.min(w, h) / 5}" class="cone"/>` : '';
  const tier = isTable(tb) && tb.color;
  if (tier) {
    const r = Math.max(6, Math.min(w, h) * 0.13);
    const cx = tb.shape === 'round' ? tb.x + w * 0.33 : tb.x + w / 2 - r - 3;
    const cy = tb.shape === 'round' ? tb.y - h * 0.33 : tb.y - h / 2 + r + 3;
    extra += `<circle class="tier-dot" cx="${cx}" cy="${cy}" r="${r}" style="fill:${tb.color}"/>`;
  }
  const style = tier && cls.includes('st-free') ? ` style="--tier:${tb.color}"` : '';
  return `<g class="${kind} ${cls}${tier ? ' tiered' : ''}"${style} ${isTable(tb) || cls.includes('edit') ? `data-tid="${tb.id}"` : ''}>${shape}${extra}${text}</g>`;
}
const TIER_COLORS = [['#D7261E', 'c_red'], ['#1FA448', 'c_green'], ['#5DADE2', 'c_blue'], ['#F5B800', 'c_yellow'], ['#4B35A8', 'c_purple'], ['#3A3A3F', 'c_black']];
const FIXTURES = {
  stage: [240, 140, 'square'], bar: [40, 240, 'square'], speaker: [44, 44, 'square'], door: [20, 80, 'square'],
  stairs: [80, 100, 'square'], restroom: [100, 80, 'square'], dj: [100, 60, 'square'], wall: [200, 12, 'square'],
  sofa: [60, 180, 'square'], zone: [120, 90, 'square'],
};
// ───────── Rooms (walls) ─────────
function boundsOf(items) {
  let x1 = 0, y1 = 0;
  for (const it of items) { const { w, h } = sizeOf(it); x1 = Math.max(x1, it.x + w / 2); y1 = Math.max(y1, it.y + h / 2); }
  return { w: Math.ceil(x1 + 24), h: Math.ceil(y1 + 24) };
}
function roomOf(layoutId, floor, items) {
  const rooms = S.edit?.layoutId === layoutId ? S.edit.rooms : S.layouts.find((l) => l.id === layoutId)?.rooms;
  const r = rooms?.[floor];
  return r?.w && r?.h ? { w: Number(r.w), h: Number(r.h) } : boundsOf(items);
}
// The drawing shows the whole room plus anything placed outside it.
function viewBoxFor(items, room, pad = 12) {
  let x0 = 0, y0 = 0, x1 = room.w, y1 = room.h;
  for (const it of items) {
    const { w, h } = sizeOf(it);
    x0 = Math.min(x0, it.x - w / 2); y0 = Math.min(y0, it.y - h / 2);
    x1 = Math.max(x1, it.x + w / 2); y1 = Math.max(y1, it.y + h / 2);
  }
  return `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
}
const wallsSvg = (room) => `<rect class="room" x="0" y="0" width="${room.w}" height="${room.h}" rx="4"/>`;

// ───────── Layout edit mode: a local draft with undo/redo, saved only on Save ─────────
const EDIT_FIELDS = ['label', 'seats', 'shape', 'floor', 'x', 'y', 'w', 'h', 'color', 'price', 'kind', 'set_note'];
let newSeq = 0;
function startEdit() {
  const lay = S.layouts.find((l) => l.id === S.editLayoutId);
  S.edit = {
    layoutId: lay.id,
    items: S.tables.filter((x) => x.layout_id === lay.id && !x.archived).map((x) => ({ ...x, ...sizeOf(x) })),
    removed: [],
    rooms: JSON.parse(JSON.stringify(lay.rooms ?? {})),
    undo: [], redo: [],
  };
  for (const f of [1, 2]) {
    if (!S.edit.rooms[f]) {
      const items = S.edit.items.filter((x) => x.floor === f);
      S.edit.rooms[f] = items.length ? boundsOf(items) : { w: 800, h: 600 };
    }
  }
  S.edit.start = snapshot();
  render();
}
const snapshot = () => JSON.stringify({ items: S.edit.items, removed: S.edit.removed, rooms: S.edit.rooms, zones: S.edit.zones ?? [] });
function restore(snap) { Object.assign(S.edit, JSON.parse(snap)); }
const isDirty = () => !!S.edit && snapshot() !== S.edit.start;
function change(fn) {
  S.edit.undo.push(snapshot());
  if (S.edit.undo.length > 100) S.edit.undo.shift();
  S.edit.redo = [];
  fn();
  render();
}
const draftItem = (id) => S.edit?.items.find((x) => x.id === id);
function confirmLeaveEdit() {
  if (!isDirty()) { S.edit = null; return true; }
  if (!confirm(t('confirm_discard'))) return false;
  S.edit = null;
  return true;
}

function addItem(kind) {
  const floor = S.editFloor;
  const room = S.edit.rooms[floor] ?? { w: 800, h: 600 };
  let row;
  if (kind === 'table') {
    const labels = S.edit.items.map((x) => x.label);
    let n = S.edit.items.filter(isTable).length + 1;
    while (labels.includes(`T${n}`)) n++;
    row = { kind, label: `T${n}`, seats: 4, shape: 'square', w: 64, h: 64, color: null, price: null };
  } else {
    const [w, h, shape] = FIXTURES[kind];
    row = { kind, label: t('fx_' + kind), seats: 0, shape, w, h, color: null, price: null };
  }
  const id = `new-${++newSeq}`;
  change(() => {
    if (!S.edit.rooms[floor]) S.edit.rooms[floor] = room;
    S.edit.items.push({ ...row, id, layout_id: S.edit.layoutId, floor, x: Math.round(room.w / 2), y: Math.round(room.h / 2), archived: false });
    S.selTable = id;
  });
}

async function saveEdit() {
  const e = S.edit, errors = [];
  const orig = new Map(S.tables.map((x) => [x.id, x]));
  const clean = (it) => Object.fromEntries(EDIT_FIELDS.map((k) => [k, it[k] ?? null]));
  for (const it of e.items) {
    try {
      if (it.id.startsWith('new-')) {
        await run(sb.from('tables').insert({ ...clean(it), layout_id: e.layoutId }));
      } else {
        const o = orig.get(it.id);
        const diff = Object.fromEntries(EDIT_FIELDS.filter((k) => String(o?.[k] ?? '') !== String(it[k] ?? '')).map((k) => [k, it[k] ?? null]));
        if (Object.keys(diff).length) await run(sb.from('tables').update(diff).eq('id', it.id));
      }
    } catch (err) { errors.push(`${it.label}: ${errMsg(err)}`); }
  }
  for (const id of e.removed) {
    try { await run(sb.from('tables').update({ archived: true }).eq('id', id)); }
    catch (err) { errors.push(`${orig.get(id)?.label ?? ''}: ${errMsg(err)}`); }
  }
  const lay = S.layouts.find((l) => l.id === e.layoutId);
  if (JSON.stringify(lay.rooms ?? {}) !== JSON.stringify(e.rooms)) {
    try { await run(sb.from('layouts').update({ rooms: e.rooms }).eq('id', e.layoutId)); }
    catch (err) { errors.push(errMsg(err)); }
  }
  S.edit = null;
  await reload();
  if (errors.length) { toast(t('save_partial') + ' ' + errors.join(' · '), true); }
  else toast(t('saved'));
}

function mapSvg() {
  const lid = nightLayoutId();
  const items = itemsOf(lid, S.floor);
  const ms = atMs();
  const body = items.map((tb) => {
    if (!isTable(tb)) return tableSvg(tb, '', []);
    const st = T.tableStateAt(tb.id, S.bookings, ms, TOPTS());
    const info = st.booking ? hhmm(st.booking.start_at) : st.next ? hhmm(st.next.start_at) : '';
    return tableSvg(tb, 'st-' + st.state + (tb.id === S.selTable && wide() ? ' sel' : ''), [tb.label, info]);
  }).join('');
  const room = roomOf(lid, S.floor, items);
  return `<svg class="floor" viewBox="${viewBoxFor(items, room)}" role="img" aria-label="${t('floor')} ${S.floor}">${wallsSvg(room)}${body}</svg>`;
}

function timeSlots() { return T.slots(S.settings, 15); }
function atIndex() {
  const slots = timeSlots();
  if (S.at !== 'now') return Math.max(0, slots.indexOf(S.at));
  if (!isTonight()) return 0;
  const now = Date.now();
  let i = 0;
  slots.forEach((x, k) => { if (T.nightTimeToMs(S.night, x, S.settings) <= now) i = k; });
  return i;
}
const atLabel = () => (S.at === 'now' && isTonight() ? `${t('now')} ${T.bkkParts(Date.now()).hhmm}` : timeSlots()[atIndex()]);

function upcomingRow(b) {
  const late = T.isLate(b, Date.now()) && isTonight();
  return `<div class="up-row ${late ? 'late' : ''}">
    <button class="up-main" data-action="open-booking" data-id="${b.id}">
      <span class="time">${hhmm(b.start_at)}</span>
      <span class="grow"><b>${esc(b.guest_name || t('walk_in'))} · ${esc(tablesLabel(b))} ${catChip(b)} ${owes(b) ? payPill(b) : ''}</b>
        <span class="small-text">${late ? t('late_by').replace('{n}', Math.round((Date.now() - T.startMs(b)) / 60000)) + ' · ' : ''}${b.party_size} ${t('people')}${b.note ? ' · ' + esc(b.note) : ''}</span></span>
    </button>
    ${isTonight() ? `<button class="${late ? 'primary' : 'ghost'} small" data-action="set-status" data-id="${b.id}" data-s="seated">${t('arrived')}</button>` : ''}
  </div>`;
}

function viewMap() {
  const tables = tablesOf(nightLayoutId(), S.floor);
  const slots = timeSlots();
  const up = T.upcoming(S.bookings, atMs());
  const moving = S.moving && S.bookings.find((b) => b.id === S.moving);
  return `<section class="mapview">
    ${moving ? `<div class="move-banner" role="status">${t('move_hint_tap').replace('{name}', esc(moving.guest_name || t('walk_in'))).replace('{table}', esc(tablesLabel(moving)))}
      <button class="ghost small" data-action="move-cancel">${t('cancel')}</button></div>` : ''}
    <div class="row wrap between toolbar">
      <div class="seg" role="tablist">${[1, 2].map((f) =>
        `<button role="tab" aria-selected="${S.floor === f}" class="${S.floor === f ? 'on' : ''}" data-action="floor" data-f="${f}">${t('floor')} ${f}</button>`).join('')}</div>
      ${wholeNight() ? '' : `<div class="timebar">
        ${ICON.clock}<span id="at-label" class="at-label">${atLabel()}</span>
        <input id="at-range" type="range" min="0" max="${slots.length - 1}" step="1" value="${atIndex()}" data-input="at" aria-label="${t('at_time')}">
        ${isTonight() && S.at !== 'now' ? `<button class="ghost small" data-action="at-now">${t('now')}</button>` : ''}
      </div>`}
      <button class="primary nb" data-action="new-booking">${ICON.plus} ${t('new_booking')}</button>
    </div>
    ${isConcertLayout(nightLayoutId()) ? `<div class="concert-bar">
      <button class="nb" data-action="view" data-v="door">${ICON.wristband} ${t('tab_door')}</button>
      <button class="nb" data-action="view" data-v="concert">${ICON.ticket} ${t('concert_report')}</button>
    </div>` : ''}
    ${tables.length ? `<div class="floor-wrap" id="floor-wrap">${mapSvg()}</div>`
      : `<p class="empty">${t('no_tables')}${isManager() ? ' ' + t('no_tables_mgr') : ''}</p>`}
    <div class="legend">
      <span><i class="dot free"></i>${t('free')}</span>
      <span><i class="dot booked"></i>${t('st_booked')}</span>
      <span><i class="dot seated"></i>${t('st_seated')}</span>
      <span><i class="dot late"></i>${t('late')}</span>
    </div>
    ${tierLegend()}
    <div class="phone-only upcoming">
      <div class="sec-title">${t('arriving')}</div>
      ${up.length ? up.slice(0, 3).map(upcomingRow).join('') : `<p class="muted small-text">${t('no_arrivals')}</p>`}
      ${up.length > 3 ? `<button class="ghost small" data-action="view" data-v="list">${t('see_all')} (${up.length})</button>` : ''}
    </div>
  </section>`;
}

function tierLegend() {
  const tiers = new Map();
  for (const tb of tablesOf(nightLayoutId(), S.floor)) {
    if (tb.color && tb.price != null) tiers.set(tb.color + tb.price, tb);
  }
  if (!tiers.size) return '';
  return `<div class="tiers">${[...tiers.values()].sort((a, b) => b.price - a.price).map((tb) =>
    `<span class="tier"><i style="background:${tb.color}"></i><b>${baht(tb.price)}</b> ${t('max_pax').replace('{n}', tb.seats)}</span>`).join('')}</div>`;
}

function viewAside() {
  const ms = atMs();
  const sel = tableById(S.selTable);
  const up = T.upcoming(S.bookings, ms);
  const seated = S.bookings.filter((b) => b.status === 'seated');
  const selCard = sel && sel.layout_id === nightLayoutId() ? (() => {
    const list = S.bookings.filter((b) => T.tablesOf(b).includes(sel.id));
    const free = isTonight() && T.tableStateAt(sel.id, S.bookings, Date.now(), TOPTS()).state === 'free';
    return `<div class="card sel-card">
      <div class="row between"><h2>${esc(sel.label)}</h2><button class="icon" data-action="unselect" aria-label="${t('close')}">${ICON.close}</button></div>
      <div class="muted small-text">${t('floor')} ${sel.floor} · ${sel.seats} ${t('seats_short')}</div>
      <div class="list">${list.length ? list.map(bookingRow).join('') : `<p class="muted small-text">${t('no_bookings')}</p>`}</div>
      <div class="row wrap">
        <button class="primary small" data-action="new-booking" data-table="${sel.id}">${ICON.plus} ${t('new_booking')}</button>
        ${free ? `<button class="small" data-action="walk-in" data-table="${sel.id}">${ICON.walk} ${t('walk_in')}</button>` : ''}
      </div>
    </div>`;
  })() : '';
  return `${selCard}
    <div class="sec-title">${t('arriving')}</div>
    ${up.length ? up.slice(0, 8).map(upcomingRow).join('') : `<p class="muted small-text">${t('no_arrivals')}</p>`}
    <div class="sec-title">${t('seated_now')} (${seated.length})</div>
    <div class="row wrap">${seated.map((b) => `<button class="seat-chip" data-action="select-table" data-id="${b.table_id}">${esc(tableById(b.table_id)?.label ?? '')}</button>`).join('') || '<span class="muted small-text">—</span>'}</div>`;
}

function bookingRow(b) {
  const st = isTonight() && T.isLate(b, Date.now()) ? 'late' : b.status;
  return `<button class="brow st-${b.status}" data-action="open-booking" data-id="${b.id}">
    <span class="time">${hhmm(b.start_at)}</span>
    <span class="grow"><strong>${esc(b.guest_name || t('walk_in'))}</strong> ${catChip(b)}
      <span class="muted small-text"> ${esc(tablesLabel(b))} · ${t('floor')} ${tableById(b.table_id)?.floor ?? ''} · ${ICON.person} ${b.party_size}</span>
      ${b.confirmed_at ? `<span class="small-text c-ok">${ICON.check} ${t('confirmed')}</span>` : ''}
      ${b.note ? `<span class="muted small-text note">${esc(b.note)}</span>` : ''}</span>
    <span class="pills">${payPill(b)}<span class="pill st-${st}">${st === 'late' ? t('late') : t('st_' + b.status)}</span></span>
  </button>`;
}

const LIST_FILTERS = {
  all: () => true,
  coming: (b) => b.status === 'booked',
  seated: (b) => b.status === 'seated',
  unpaid: owes,
  remind: (b) => b.status === 'booked' && !b.reminded_at && !b.confirmed_at && !!b.phone,
  closed: (b) => ['done', 'cancelled', 'no_show'].includes(b.status),
};
function filteredBookings() {
  const q = (S.q ?? '').trim().toLowerCase();
  return S.bookings.filter(LIST_FILTERS[S.filter ?? 'all']).filter((b) => !q ||
    [b.guest_name, b.phone, tableById(b.table_id)?.label, b.note].some((v) => String(v ?? '').toLowerCase().includes(q)));
}
function listRows() {
  const rows = filteredBookings();
  return rows.length ? rows.map(bookingRow).join('') : `<p class="empty">${t('no_bookings')}</p>`;
}
function viewList() {
  const f = S.filter ?? 'all';
  const count = (k) => S.bookings.filter(LIST_FILTERS[k]).length;
  return `<section>
    <div class="row between toolbar">
      <h2>${S.bookings.length} ${t('bookings_word')}</h2>
      <button class="primary" data-action="new-booking">${ICON.plus} ${t('new_booking')}</button>
    </div>
    <div class="filters" role="group" aria-label="${t('filter')}">
      ${Object.keys(LIST_FILTERS).map((k) => `<button class="fchip ${f === k ? 'on' : ''}" data-action="filter" data-f="${k}" aria-pressed="${f === k}">${t('f_' + k)} <b>${count(k)}</b></button>`).join('')}
    </div>
    <input class="search" type="search" placeholder="${t('search_ph')}" value="${esc(S.q ?? '')}" data-input="q" aria-label="${t('search_ph')}">
    <div class="list" id="list-rows">${listRows()}</div>
  </section>`;
}

function viewSummary() {
  const s = T.summary(S.bookings);
  const card = (n, label) => `<div class="stat"><div class="num">${n}</div><div class="muted">${label}</div></div>`;
  const priced = S.bookings.filter((b) => needsPayment(b) || tracksPayment(b));
  const got = S.bookings.reduce((n, b) => n + receivedOfB(b), 0);
  const owed = S.bookings.filter(owes).reduce((n, b) => n + Math.max(0, dueOfB(b) - paidOfB(b)), 0);
  return `<section>
    ${priced.length ? `<div class="stats money">
      ${card(baht(got), t('sum_paid'))}
      ${card(baht(owed), t('sum_owed'))}
    </div>` : ''}
    <div class="stats">
      ${card(s.bookings, t('sum_bookings'))}
      ${card(s.guests, t('sum_guests'))}
      ${card(s.walkIns, t('sum_walkins'))}
      ${card(s.cancelled, t('sum_cancelled'))}
      ${card(s.noShows, t('sum_noshows'))}
    </div>
    ${priced.length ? cashUpSection() : ''}
  </section>`;
}

// End-of-night cash-up: what came in by method and by staff, what is still to collect, and the drawer count.
function cashUpSection() {
  const c = cashUp(S.bookings, dueOfB);
  const row = (k, v, cls = '') => `<div class="pay-row ${cls}"><span class="grow">${k}</span><b>${v}</b></div>`;
  return `<section class="blk cashup">
    <h3>${ICON.chart} ${t('cashup')}</h3>
    <div class="cash-cols">
      <div>
        <div class="sec-title">${t('cash_by_method')}</div>
        ${['cash', 'transfer', 'card'].map((m) => row(t('m_' + m), baht(c.byMethod[m]))).join('')}
        ${c.unrecorded ? row(t('cash_unrecorded'), baht(c.unrecorded), 'muted') : ''}
        ${row(`<b>${t('total')}</b>`, baht(c.total), 'total')}
      </div>
      <div>
        <div class="sec-title">${t('cash_by_staff')}</div>
        ${c.byStaff.map((x) => row(esc(personName(x.id)), baht(x.amount))).join('') || '<p class="muted small-text">—</p>'}
      </div>
    </div>
    <div class="sec-title">${t('cash_to_collect')} (${c.outstanding.length}) · ${baht(c.toCollect)}</div>
    <div class="list">${c.outstanding.map((o) => `<button class="brow" data-action="open-booking" data-id="${o.booking.id}">
      <span class="time">${esc(tablesLabel(o.booking))}</span>
      <span class="grow"><strong>${esc(o.booking.guest_name || t('walk_in'))}</strong></span>
      <span class="pills">${payPill(o.booking)}<b>${baht(o.left)}</b></span></button>`).join('') || `<p class="muted small-text">${t('cash_all_in')}</p>`}</div>
    <div class="drawer">
      <label>${t('cash_counted')}<input type="number" inputmode="numeric" min="0" step="1" data-input="drawer" data-expect="${c.byMethod.cash}" placeholder="${c.byMethod.cash}"></label>
      <div id="drawer-diff" class="drawer-diff muted small-text">${t('cash_expected').replace('{n}', baht(c.byMethod.cash))}</div>
    </div>
    <button class="ghost" data-action="cashup-share">${ICON.send} ${t('cash_share')}</button>
  </section>`;
}
function cashUpText() {
  const c = cashUp(S.bookings, dueOfB);
  const counted = Number($('[data-input=drawer]')?.value || NaN);
  return [
    `${t('cashup')} ${fmtNight(S.night)} · ${layoutName(nightLayoutId())}`,
    ...['cash', 'transfer', 'card'].map((m) => `${t('m_' + m)}: ${baht(c.byMethod[m])}`),
    c.unrecorded ? `${t('cash_unrecorded')}: ${baht(c.unrecorded)}` : '',
    `${t('total')}: ${baht(c.total)}`,
    Number.isFinite(counted) ? `${t('cash_counted')}: ${baht(counted)} (${counted - c.byMethod.cash >= 0 ? '+' : '−'}${baht(Math.abs(counted - c.byMethod.cash))})` : '',
    c.outstanding.length ? `${t('cash_to_collect')}: ${c.outstanding.map((o) => `${tablesLabel(o.booking)} ${baht(o.left)}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

// ───────── Door mode (concert check-in) ─────────
// Search a name, phone or table; one tap seats the guests and gives the wristband.
const doorRows = () => {
  const q = (S.doorQ ?? '').trim().toLowerCase();
  const f = S.doorF ?? 'coming';
  return S.bookings.filter((b) => isOpen(b) && b.status !== 'done')
    .filter((b) => f === 'all' || (f === 'coming' ? b.status === 'booked' : b.status === 'seated'))
    .filter((b) => !q || [b.guest_name, b.phone, tablesLabel(b)].some((v) => String(v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => tablesLabel(a).localeCompare(tablesLabel(b), undefined, { numeric: true }));
};
function doorCard(b) {
  const concert = isConcertLayout(nightLayoutId());
  const unpaid = owes(b);
  let action;
  if (b.status === 'booked') action = `<button class="primary door-go" data-action="checkin" data-id="${b.id}">${ICON.check} ${concert ? t('checkin') : t('act_seat')}</button>`;
  else if (concert && !b.wristband_at) action = `<button class="primary door-go" data-action="wristband" data-from="door" data-id="${b.id}" data-v="1">${ICON.wristband} ${t('wb_give')}</button>`;
  else action = `<span class="door-done">${ICON.check} ${t('step_seated')}${b.wristband_at ? ' · ' + t('wristband') : ''}</span>`;
  const sets = T.tablesOf(b).map((id) => tableById(id)?.set_note).filter(Boolean);
  return `<div class="door-card ${unpaid ? 'owes' : ''} st-${b.status}">
    <button class="bk-table sm" data-action="open-booking" data-id="${b.id}" aria-label="${t('details_more')}">${esc(tablesLabel(b))}</button>
    <div class="grow door-info">
      <b>${esc(b.guest_name || t('walk_in'))}</b>
      <span class="muted small-text">${esc(b.phone || '')} · ${ICON.person} ${b.party_size}${sets.length ? ' · ' + esc(sets.join(' + ')) : ''}</span>
      <span class="row wrap">${payPill(b)}${catChip(b)}</span>
    </div>
    ${action}
  </div>`;
}
function viewDoor() {
  const live = S.bookings.filter((b) => isOpen(b));
  const arrived = live.filter((b) => b.status === 'seated' || b.status === 'done').length;
  const wb = live.filter((b) => b.wristband_at).length;
  const concert = isConcertLayout(nightLayoutId());
  const f = S.doorF ?? 'coming';
  return `<section class="door">
    <div class="stats-row">
      <span class="chip"><b>${arrived}/${live.length}</b> ${t('step_seated')}</span>
      ${concert ? `<span class="chip"><b>${wb}/${live.length}</b> ${t('wristband')}</span>` : ''}
      ${live.filter(owes).length ? `<span class="chip unpaid"><b>${live.filter(owes).length}</b> ${t('f_unpaid')}</span>` : ''}
    </div>
    <input class="search door-search" type="search" placeholder="${t('door_search')}" value="${esc(S.doorQ ?? '')}" data-input="door-q" aria-label="${t('door_search')}" enterkeyhint="search">
    <div class="filters">${['coming', 'seated', 'all'].map((k) => `<button class="fchip ${f === k ? 'on' : ''}" data-action="door-filter" data-f="${k}" aria-pressed="${f === k}">${t('door_f_' + k)}</button>`).join('')}</div>
    <div id="door-rows" class="door-rows">${doorList()}</div>
  </section>`;
}
const doorList = () => { const r = doorRows(); return r.length ? r.map(doorCard).join('') : `<p class="empty">${t('door_none')}</p>`; };

// ───────── Layouts page ─────────
// Concert layout = a layout whose tables have price zones. Zones are colour + price + set drinks, applied to tables.
const zoneKey = (x) => `${x.color ?? ''}|${x.price ?? ''}|${x.set_note ?? ''}`;
function zonesOf(items) {
  const m = new Map();
  for (const x of items.filter(isTable)) {
    if (x.price == null && !x.color) continue;
    const k = zoneKey(x);
    const z = m.get(k) ?? { color: x.color ?? '#ACC1C6', price: x.price, set_note: x.set_note ?? '', count: 0 };
    z.count++; m.set(k, z);
  }
  for (const z of S.edit?.zones ?? []) if (!m.has(zoneKey(z))) m.set(zoneKey(z), { ...z, count: 0 });
  return [...m.values()].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
}
const zoneLabel = (z) => `${z.price != null ? baht(z.price) : '—'}${z.set_note ? ' · ' + z.set_note : ''}`;

const layoutKind = (id) => (isConcertLayout(id) ? t('badge_concert') : t('badge_normal'));
function viewLayouts() {
  if (S.edit && !S.layouts.some((l) => l.id === S.edit.layoutId)) S.edit = null;
  if (!S.editLayoutId) S.editLayoutId = nightLayoutId() ?? S.layouts[0]?.id;
  const lay = S.layouts.find((l) => l.id === S.editLayoutId);
  if (!lay) return `<section><button class="primary big" data-action="layout-create">${ICON.plus} ${t('create_layout')}</button></section>`;
  const editing = S.edit?.layoutId === lay.id;
  const all = editing ? S.edit.items : itemsOf(lay.id);
  const items = all.filter((x) => x.floor === S.editFloor);
  const room = roomOf(lay.id, S.editFloor, items);
  const sel = editing ? draftItem(S.selTable) : null;
  const floorSeg = `<div class="seg">${[1, 2].map((f) =>
    `<button class="${S.editFloor === f ? 'on' : ''}" data-action="edit-floor" data-f="${f}">${t('floor')} ${f}</button>`).join('')}</div>`;
  const handle = editing ? `<g class="room-handle" data-handle="room"><circle cx="${room.w}" cy="${room.h}" r="16"/><path d="M${room.w - 6} ${room.h + 2}l8-8M${room.w - 1} ${room.h + 6}l6-6"/></g>` : '';
  const assigning = editing && S.edit.assign != null ? zonesOf(S.edit.items)[S.edit.assign] : null;
  const svg = `<svg id="editor-svg" class="floor editor ${editing ? 'editing' : ''} ${assigning ? 'assigning' : ''}" viewBox="${viewBoxFor(items, room, editing ? 60 : 12)}">
    ${wallsSvg(room)}
    ${items.map((tb) => tableSvg(tb, 'edit' + (editing && tb.id === S.selTable && !assigning ? ' sel' : '') + (assigning && isTable(tb) && zoneKey(tb) === zoneKey(assigning) ? ' in-zone' : ''),
      [tb.label, isTable(tb) ? (tb.price != null ? baht(tb.price) : `${tb.seats} ${t('seats_short')}`) : ''])).join('')}
    ${handle}
  </svg>`;

  if (!editing) {
    const nZones = zonesOf(itemsOf(lay.id)).length;
    return `<section class="layouts-page">
      <div class="lay-head">
        <label class="lay-select">
          <span class="field-label">${t('layouts_title')} (${S.layouts.length})</span>
          <select data-change="pick-edit-layout" aria-label="${t('layouts_title')}">${S.layouts.map((l) =>
            `<option value="${l.id}" ${l.id === lay.id ? 'selected' : ''}>${esc(l.name)} · ${layoutKind(l.id)}${l.is_default ? ' · ' + t('default') : ''}</option>`).join('')}</select>
        </label>
        <button class="icon more-btn" data-action="layout-menu" aria-label="${t('more')}">${ICON.more}</button>
      </div>
      <div class="lay-meta">
        <span class="badge-s ${isConcertLayout(lay.id) ? 'concert' : ''}">${layoutKind(lay.id)}</span>
        ${lay.is_default ? `<span class="badge-s">${t('default')}</span>` : ''}
        <span class="muted small-text">${t('tables_count').replace('{n}', tablesOf(lay.id).length)}${nZones ? ' · ' + t('zones_count').replace('{n}', nZones) : ''}</span>
      </div>
      <div class="lay-actions">
        <button class="primary" data-action="edit-start">${ICON.edit} ${t('edit_layout')}</button>
        <button class="ghost" data-action="layout-create">${ICON.plus} ${t('create_layout')}</button>
      </div>
      <div class="row toolbar">${floorSeg}</div>
      <div class="floor-wrap">${svg}</div>
    </section>`;
  }

  const zones = zonesOf(S.edit.items);
  return `<section>
    <div class="editbar">
      <button class="icon-btn" data-action="undo" ${S.edit.undo.length ? '' : 'disabled'} aria-label="${t('undo')}" title="${t('undo')}">${ICON.undo}</button>
      <button class="icon-btn" data-action="redo" ${S.edit.redo.length ? '' : 'disabled'} aria-label="${t('redo')}" title="${t('redo')}">${ICON.redo}</button>
      <span class="edit-title"><small>${t('editing')}${isDirty() ? ` · <i class="dirty">${t('unsaved')}</i>` : ''}</small>${esc(lay.name)}</span>
      <button class="ghost small" data-action="edit-cancel">${t('cancel')}</button>
      <button class="primary small" data-action="edit-save" ${isDirty() ? '' : 'disabled'}>${t('save')}</button>
    </div>
    <div class="row between toolbar">
      ${floorSeg}
      <button class="primary" data-action="add-open">${ICON.plus} ${t('add')}</button>
    </div>
    <details class="blk fold zones" data-fold="zones" ${S.edit.zonesOpen ? 'open' : ''}>
      <summary>${ICON.ticket} ${t('zones')} ${zones.length ? `<span class="muted small-text">(${zones.length})</span>` : ''} ${ICON.chev}</summary>
      <p class="muted small-text">${t('zones_help')}</p>
      ${assigning ? `<div class="assign-banner" role="status"><i class="zdot" style="background:${esc(assigning.color)}"></i>
        <span class="grow">${t('zone_assign_hint').replace('{z}', esc(zoneLabel(assigning)))}</span>
        <button class="primary small" data-action="zone-assign-done">${t('done')}</button></div>` : ''}
      <div class="zone-list">${zones.map((z, i) => `<div class="zone-row ${S.edit.assign === i ? 'on' : ''}">
        <i class="zdot" style="background:${esc(z.color)}"></i>
        <span class="grow"><b>${z.price != null ? baht(z.price) : '—'}</b> <span class="muted small-text">${esc(z.set_note || '')}</span><br><span class="muted small-text">${t('tables_count').replace('{n}', z.count)}</span></span>
        <button class="small" data-action="zone-assign" data-i="${i}">${t('zone_assign')}</button>
        <button class="ghost small" data-action="zone-edit" data-i="${i}">${t('edit')}</button>
      </div>`).join('') || `<p class="muted small-text">${t('no_zones')}</p>`}</div>
      <button class="primary small" data-action="zone-new">${ICON.plus} ${t('zone_add')}</button>
    </details>
    <details class="blk fold" data-fold="room">
      <summary>${ICON.map} ${t('room_size')} <span class="muted small-text">${Math.round(room.w)} × ${Math.round(room.h)}</span> ${ICON.chev}</summary>
      <form data-form="room" class="room-bar">
        <label class="inline-label">${t('width')}<input name="w" type="number" min="100" max="3000" value="${Math.round(room.w)}"></label>
        <label class="inline-label">${t('depth')}<input name="h" type="number" min="100" max="3000" value="${Math.round(room.h)}"></label>
        <button class="small" type="submit">${t('apply')}</button>
        <button class="ghost small" type="button" data-action="room-fit">${t('room_fit')}</button>
      </form>
    </details>
    <p class="muted small-text">${assigning ? '' : t('drag_hint_edit')}</p>
    <div class="floor-wrap">${svg}</div>
    ${sel && !assigning ? `<form data-form="table" class="panel stack">
      <input type="hidden" name="id" value="${sel.id}">
      <div class="grid2">
        <label>${t('table_name')}<input name="label" value="${esc(sel.label)}" required maxlength="20"></label>
        ${isTable(sel) ? `<label>${t('seats')}<input name="seats" type="number" min="1" max="50" value="${sel.seats}" required></label>` : `<input type="hidden" name="seats" value="0">`}
        ${isTable(sel) ? `<label>${t('zone')}<select name="zone">
          <option value="">${t('no_zone')}</option>
          ${zones.map((z, i) => `<option value="${i}" ${zoneKey(sel) === zoneKey(z) ? 'selected' : ''}>${esc(zoneLabel(z))}</option>`).join('')}
        </select></label>` : ''}
        <label>${t('width')}<input name="w" type="number" min="10" max="1000" step="1" value="${sizeOf(sel).w}" required></label>
        <label>${t('height')}<input name="h" type="number" min="10" max="1000" step="1" value="${sizeOf(sel).h}" required></label>
        <label>${t('shape')}<select name="shape">
          <option value="square" ${sel.shape === 'square' ? 'selected' : ''}>${t('square')}</option>
          <option value="round" ${sel.shape === 'round' ? 'selected' : ''}>${t('round')}</option></select></label>
        <label>${t('floor')}<select name="floor">${[1, 2].map((f) => `<option ${sel.floor === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      </div>
      <div class="row wrap">
        <button class="primary" type="submit">${t('apply')}</button>
        <button class="ghost danger" type="button" data-action="table-remove" data-id="${sel.id}">${t('remove_table')}</button>
      </div>
    </form>` : assigning ? '' : `<p class="muted small-text">${t('tap_to_edit')}</p>`}
  </section>`;
}

// New layout: name, type (normal / concert), blank or copied from another layout.
function openCreateLayout() {
  openModal(`<h2>${t('create_layout')}</h2>
    <form data-form="layout-create" class="stack">
      <label>${t('layout_name')}<input name="name" required maxlength="60" placeholder="${t('layout_name_ph')}"></label>
      <fieldset class="mode-pick"><legend>${t('layout_type')}</legend>
        ${['concert', 'normal'].map((k, i) => `<label class="radio-card"><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''}>
          <span><b>${t('type_' + k)}</b><small>${t('type_' + k + '_help')}</small></span></label>`).join('')}
      </fieldset>
      <label>${t('start_from')}<select name="source">
        <option value="">${t('start_blank')}</option>
        ${S.layouts.map((l) => `<option value="${l.id}">${t('start_copy')}: ${esc(l.name)}</option>`).join('')}
      </select></label>
      <button class="primary big" type="submit">${t('create')}</button>
    </form>`);
}
async function createLayout(f) {
  const v = Object.fromEntries(new FormData(f));
  const name = v.name.trim();
  if (!name) return;
  try {
    const id = v.source
      ? await run(sb.rpc('duplicate_layout', { p_layout: v.source, p_name: name }), 'layout.duplicate')
      : (await run(sb.from('layouts').insert({ name }).select().single(), 'layout.insert')).id;
    log.info('layout.created', { type: v.type, copied: !!v.source });
    closeModal();
    S.editLayoutId = id; S.editFloor = 1; S.selTable = null;
    await reload();
    startEdit();
    if (v.type === 'concert') { S.edit.zonesOpen = true; render(); }
    toast(t('layout_created'));
  } catch (e) { toast(errMsg(e), true); }
}

// Zone form (new or edit): colour, price, set drinks. Editing applies to every table in the zone.
function openZoneForm(i) {
  const z = i != null ? zonesOf(S.edit.items)[i] : { color: TIER_COLORS[S.edit.items.length % TIER_COLORS.length][0], price: '', set_note: '' };
  openModal(`<h2>${i != null ? t('zone_edit') : t('zone_new')}</h2>
    <form data-form="zone" class="stack">
      <input type="hidden" name="i" value="${i ?? ''}">
      <div class="field-label">${t('tier_color')}</div>
      <div class="chip-radios">${TIER_COLORS.map(([c, k]) => `<label class="chip-radio" style="--c:${c}"><input type="radio" name="color" value="${c}" ${z.color === c ? 'checked' : ''}><span><i class="zdot" style="background:${c}"></i>${t(k)}</span></label>`).join('')}</div>
      <div class="grid2">
        <label>${t('price')}<input name="price" type="number" min="0" step="100" inputmode="numeric" value="${z.price ?? ''}" required></label>
        <label>${t('set_drinks')}<input name="set_note" maxlength="80" value="${esc(z.set_note ?? '')}" placeholder="Monkey 1 ขวด"></label>
      </div>
      <button class="primary big" type="submit">${i != null ? t('save') : t('zone_save_pick')}</button>
      ${i != null ? `<button class="ghost danger" type="button" data-action="zone-remove" data-i="${i}">${t('zone_remove')}</button>` : ''}
    </form>`);
}
const zoneFields = (z) => ({ color: z.color, price: z.price, set_note: z.set_note || null });
function saveZone(f) {
  const v = Object.fromEntries(new FormData(f));
  const nz = { color: v.color, price: Math.round(Number(v.price)), set_note: v.set_note.trim() };
  closeModal();
  change(() => {
    if (v.i !== '') {
      const old = zonesOf(S.edit.items)[Number(v.i)];
      for (const it of S.edit.items) if (isTable(it) && zoneKey(it) === zoneKey(old)) Object.assign(it, zoneFields(nz));
      S.edit.zones = (S.edit.zones ?? []).filter((z) => zoneKey(z) !== zoneKey(old));
    }
    S.edit.zones = [...(S.edit.zones ?? []), nz];
    S.edit.zonesOpen = true;
    S.edit.assign = v.i !== '' ? null : zonesOf(S.edit.items).findIndex((z) => zoneKey(z) === zoneKey(nz));
    S.selTable = null;
  });
}
// Tap a table while choosing tables for a zone: in → out, out → in.
function toggleZone(id) {
  const z = zonesOf(S.edit.items)[S.edit.assign];
  const it = draftItem(id);
  if (!z || !it || !isTable(it)) return;
  change(() => {
    if (zoneKey(it) === zoneKey(z)) Object.assign(it, { color: null, price: null, set_note: null });
    else Object.assign(it, zoneFields(z));
    S.edit.assign = zonesOf(S.edit.items).findIndex((x) => zoneKey(x) === zoneKey(z));
  });
}

// Add many tables at once (A1…A18), laid out in rows inside the room.
function openBulkAdd() {
  const zones = zonesOf(S.edit.items);
  openModal(`<h2>${t('bulk_add')}</h2>
    <form data-form="bulk" class="stack">
      <div class="grid2">
        <label>${t('prefix')}<input name="prefix" value="A" maxlength="6"></label>
        <label>${t('start_no')}<input name="start" type="number" min="0" value="1" required></label>
        <label>${t('count')}<input name="count" type="number" min="1" max="60" value="10" required></label>
        <label>${t('seats')}<input name="seats" type="number" min="1" max="50" value="5" required></label>
        <label>${t('shape')}<select name="shape"><option value="round">${t('round')}</option><option value="square">${t('square')}</option></select></label>
        ${zones.length ? `<label>${t('zone')}<select name="zone"><option value="">${t('no_zone')}</option>${zones.map((z, i) => `<option value="${i}">${esc(zoneLabel(z))}</option>`).join('')}</select></label>` : ''}
      </div>
      <p class="muted small-text">${t('bulk_help')}</p>
      <button class="primary big" type="submit">${t('add')}</button>
    </form>`);
}
function bulkAdd(f) {
  const v = Object.fromEntries(new FormData(f));
  const floor = S.editFloor, n = Math.min(60, Math.max(1, Number(v.count)));
  const room = S.edit.rooms[floor] ?? { w: 800, h: 600 };
  const z = v.zone ? zonesOf(S.edit.items)[Number(v.zone)] : null;
  const size = 64, gap = 24, perRow = Math.max(1, Math.floor((room.w - gap) / (size + gap)));
  const taken = new Set(S.edit.items.map((x) => x.label));
  closeModal();
  change(() => {
    if (!S.edit.rooms[floor]) S.edit.rooms[floor] = room;
    for (let k = 0; k < n; k++) {
      let num = Number(v.start) + k, label = `${v.prefix}${num}`;
      while (taken.has(label)) label = `${v.prefix}${++num}_`;
      taken.add(label);
      S.edit.items.push({
        id: `new-${++newSeq}`, layout_id: S.edit.layoutId, floor, kind: 'table', label, seats: Number(v.seats), shape: v.shape, w: size, h: size,
        x: gap + size / 2 + (k % perRow) * (size + gap), y: gap + size / 2 + Math.floor(k / perRow) * (size + gap), archived: false,
        color: null, price: null, set_note: null, ...(z ? zoneFields(z) : {}),
      });
    }
    S.selTable = null;
  });
  log.info('layout.bulk_add', { n });
}

function viewStaff() {
  return `<section>
    <div class="list">${S.profiles.map((p) => `<div class="srow">
      <div class="grow"><strong>${esc(p.display_name)}</strong><div class="muted small-text">${esc(p.email)}</div></div>
      <select data-change="staff-role" data-id="${p.id}">
        <option value="staff" ${p.role === 'staff' ? 'selected' : ''}>${t('role_staff')}</option>
        <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>${t('role_manager')}</option>
      </select>
      <label class="row inline-label"><input type="checkbox" data-change="staff-active" data-id="${p.id}" ${p.active ? 'checked' : ''}> ${t('active')}</label>
    </div>`).join('')}</div>
    <h3>${t('add_staff')}</h3>
    <form data-form="staff" class="panel stack">
      <div class="grid2">
        <label>${t('name')}<input name="display_name" required></label>
        <label>${t('email')}<input name="email" type="email" required></label>
        <label>${t('password')}<input name="password" type="text" minlength="8" required autocomplete="new-password"></label>
        <label>${t('role')}<select name="role"><option value="staff">${t('role_staff')}</option><option value="manager">${t('role_manager')}</option></select></label>
      </div>
      <button class="primary" type="submit">${t('create_account')}</button>
    </form>
  </section>`;
}

function viewSettings() {
  const s = S.settings;
  const notifyOn = deviceNotify();
  return `<section class="settings">
    <h2>${t('hours')}</h2>
    <form data-form="settings" class="panel stack">
      <div class="grid2">
        <label>${t('open_time')}<input name="open_time" type="time" value="${s.open_time.slice(0, 5)}" required></label>
        <label>${t('close_time')}<input name="close_time" type="time" value="${s.close_time.slice(0, 5)}" required></label>
      </div>
      <p class="muted small-text">${t('night_rule')}</p>
      <fieldset class="mode-pick">
        <legend>${t('booking_mode')}</legend>
        ${['night', 'timed'].map((m) => `<label class="radio-card"><input type="radio" name="booking_mode" value="${m}" ${(s.booking_mode ?? 'night') === m ? 'checked' : ''} data-change="mode">
          <span><b>${t('mode_' + m)}</b><small>${t('mode_' + m + '_help')}</small></span></label>`).join('')}
        <label class="duration-field" ${(s.booking_mode ?? 'night') === 'timed' ? '' : 'hidden'}>${t('default_duration')}<input name="default_duration_min" type="number" min="15" max="720" step="15" value="${s.default_duration_min}" required></label>
      </fieldset>
      <button class="primary" type="submit">${t('save')}</button>
    </form>

    <h2>${t('categories')}</h2>
    <div class="panel stack">
      <p class="muted small-text">${t('categories_help')}</p>
      ${(S.categories ?? []).map((c) => `<form data-form="category" class="cat-row">
        <input type="hidden" name="id" value="${c.id}">
        <input type="color" name="color" value="${esc(c.color)}" aria-label="${t('color')}">
        <input name="name" value="${esc(c.name)}" maxlength="60" required aria-label="${t('name')}">
        <label class="inline-label pct"><input name="discount_pct" type="number" min="0" max="100" step="1" value="${c.discount_pct}" aria-label="${t('discount_pct')}"> %</label>
        <label class="inline-label"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> ${t('active')}</label>
        <button class="small" type="submit">${t('save')}</button>
      </form>`).join('')}
      <form data-form="category" class="cat-row">
        <input type="color" name="color" value="#F39646" aria-label="${t('color')}">
        <input name="name" maxlength="60" required placeholder="${t('new_category')}" aria-label="${t('new_category')}">
        <label class="inline-label pct"><input name="discount_pct" type="number" min="0" max="100" step="1" value="0" aria-label="${t('discount_pct')}"> %</label>
        <input type="hidden" name="active" value="on">
        <button class="primary small" type="submit">${ICON.plus} ${t('add')}</button>
      </form>
    </div>

    <h2>${t('messages')}</h2>
    <form data-form="messages" class="panel stack">
      <label>${t('shop_name')}<input name="shop_name" value="${esc(s.shop_name)}" maxlength="80" required></label>
      <label>${t('confirm_template')}<textarea name="confirm_template" rows="6" maxlength="1000">${esc(s.confirm_template)}</textarea></label>
      <label>${t('reminder_template')}<textarea name="reminder_template" rows="5" maxlength="1000">${esc(s.reminder_template)}</textarea></label>
      <p class="muted small-text">${t('template_help')}</p>
      <button class="primary" type="submit">${t('save')}</button>
    </form>

    <h2>${t('products')}</h2>
    <div class="panel stack">
      ${(S.products ?? []).map((p) => `<form data-form="product" class="product-row">
        <input type="hidden" name="id" value="${p.id}">
        <input name="name" value="${esc(p.name)}" maxlength="80" required aria-label="${t('name')}">
        <input name="price" type="number" min="0" step="10" value="${p.price}" required aria-label="${t('price')}">
        <label class="inline-label"><input type="checkbox" name="per_person" ${p.per_person ? 'checked' : ''}> ${t('per_person')}</label>
        <label class="inline-label"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> ${t('active')}</label>
        <button class="small" type="submit">${t('save')}</button>
      </form>`).join('')}
      <form data-form="product" class="product-row">
        <input name="name" maxlength="80" required placeholder="${t('new_product')}" aria-label="${t('new_product')}">
        <input name="price" type="number" min="0" step="10" required placeholder="${t('price')}" aria-label="${t('price')}">
        <label class="inline-label"><input type="checkbox" name="per_person"> ${t('per_person')}</label>
        <input type="hidden" name="active" value="on">
        <button class="primary small" type="submit">${ICON.plus} ${t('add')}</button>
      </form>
    </div>

    <h2>${t('notifications')}</h2>
    <div class="panel row wrap between">
      <span>${t('device_notify')}<br><span class="muted small-text">${t('device_notify_help')}</span></span>
      <button class="${notifyOn ? 'ghost' : 'primary'}" data-action="toggle-notify">${notifyOn ? t('turn_off') : t('turn_on')}</button>
    </div>

    <h2>${t('backup')}</h2>
    <div class="panel stack">
      <p class="muted small-text">${t('backup_help')}</p>
      <div class="row wrap">
        <button data-action="csv" data-kind="bookings" data-range="90">${ICON.download} ${t('csv_bookings')}</button>
        <button data-action="csv" data-kind="payments" data-range="90">${ICON.download} ${t('csv_payments')}</button>
        <button data-action="csv" data-kind="guests">${ICON.download} ${t('csv_guests')}</button>
      </div>
    </div>

    <h2>${t('diagnostics')}</h2>
    <div class="panel stack diag">
      <dl class="facts">
        <dt>${t('version')}</dt><dd>${esc(VERSION)}</dd>
        <dt>${t('signed_in_as')}</dt><dd>${esc(S.me.email ?? S.me.display_name)} (${t('role_' + S.me.role)})</dd>
        <dt>${t('connection')}</dt><dd>${navigator.onLine ? t('online') : t('offline')} · realtime ${esc(S.realtime ?? '—')}</dd>
        <dt>${t('debug_mode')}</dt><dd>${isDebug() ? t('on') : t('off')}</dd>
      </dl>
      <div class="row wrap">
        <button class="small" data-action="debug-toggle">${isDebug() ? t('debug_off') : t('debug_on')}</button>
        <button class="small" data-action="diag-copy">${t('copy_diag')}</button>
        <button class="small" data-action="server-logs">${t('server_logs')}</button>
      </div>
      <div class="sec-title">${t('recent_logs')}</div>
      <div class="log-list">${recentLogs().slice(-40).reverse().map(logRow).join('') || '<span class="muted small-text">—</span>'}</div>
      <div id="server-logs"></div>
    </div>
  </section>`;
}
const logRow = (e) => `<div class="log-row lv-${e.level}"><span class="muted">${T.bkkParts(Date.parse(e.at)).hhmm}</span> <b>${e.level}</b> ${esc(e.event)}${e.message ? ` <span class="muted">${esc(e.message).slice(0, 160)}</span>` : ''}</div>`;

// ───────── Reports (managers) ─────────
const REPORT_RANGES = { 7: 'r_7', 30: 'r_30', month: 'r_month', last_month: 'r_last_month' };
function reportRange(key) {
  const today = T.nightOf(Date.now(), S.settings);
  if (key === 'month') return [today.slice(0, 8) + '01', today];
  if (key === 'last_month') {
    const d = new Date(today.slice(0, 8) + '01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
    const from = d.toISOString().slice(0, 10);
    const end = new Date(today.slice(0, 8) + '01T00:00:00Z'); end.setUTCDate(0);
    return [from, end.toISOString().slice(0, 10)];
  }
  return [T.addDays(today, -(Number(key) - 1)), today];
}
async function loadReport() {
  const [from, to] = reportRange(S.reportKey ?? '7');
  S.report = { from, to, loading: true };
  render();
  try {
    const rows = await run(sb.from('bookings').select(BOOKING_SELECT).gte('night', from).lte('night', to).order('start_at'), 'report.load');
    S.report = { from, to, rows, sum: summarizeRange(rows, tableById, categoryById) };
    log.info('report.loaded', { from, to, n: rows.length });
  } catch (e) { S.report = { from, to, error: errMsg(e) }; }
  if (S.view === 'reports') render();
}
function viewReports() {
  if (!S.report) { loadReport(); return `<p class="muted">${t('loading')}</p>`; }
  const r = S.report;
  const key = S.reportKey ?? '7';
  const head = `<div class="filters">${Object.entries(REPORT_RANGES).map(([k, l]) =>
    `<button class="fchip ${k === key ? 'on' : ''}" data-action="report-range" data-k="${k}">${t(l)}</button>`).join('')}</div>
    <p class="muted small-text">${fmtNight(r.from)} – ${fmtNight(r.to)}</p>`;
  if (r.loading) return `<section>${head}<p class="muted">${t('loading')}</p></section>`;
  if (r.error) return `<section>${head}<p class="err">${esc(r.error)}</p></section>`;
  const s = r.sum, tt = s.totals;
  const card = (n, label, cls = '') => `<div class="stat ${cls}"><div class="num">${n}</div><div class="muted">${label}</div></div>`;
  const maxC = Math.max(1, ...s.perNight.map((n) => n.collected));
  const maxB = Math.max(1, ...s.perNight.map((n) => n.bookings));
  return `<section>
    ${head}
    <div class="stats">
      ${card(baht(tt.collected), t('sum_paid'), 'money-ok')}
      ${card(baht(tt.outstanding), t('sum_owed'), 'money-owed')}
      ${card(tt.bookings, t('sum_bookings'))}
      ${card(tt.guests, t('sum_guests'))}
      ${card(`${Math.round(tt.noShowRate * 100)}%`, t('no_show_rate') + ` (${tt.noShows})`)}
      ${card(tt.cancelled, t('sum_cancelled'))}
    </div>
    <h3>${t('per_night')}</h3>
    ${s.perNight.length ? `<div class="bars" role="table">${s.perNight.map((n) => `<div class="bar-row" role="row">
      <span class="bar-label" role="cell">${fmtNight(n.night)}</span>
      <span class="bar-track" role="cell" aria-label="${baht(n.collected)}"><i class="bar money" style="width:${(n.collected / maxC) * 100}%"></i></span>
      <span class="bar-val" role="cell">${baht(n.collected)}</span>
      <span class="bar-track thin" role="cell" aria-label="${n.bookings}"><i class="bar" style="width:${(n.bookings / maxB) * 100}%"></i></span>
      <span class="bar-val" role="cell">${n.bookings} ${t('bookings_word')}</span>
    </div>`).join('')}</div>` : `<p class="muted">${t('no_bookings')}</p>`}
    <div class="grid2 report-cols">
      <div><h3>${t('top_tables')}</h3>
        ${s.topTables.map((x) => `<div class="pay-row"><span>${esc(x.label)}</span><b>${x.count}</b></div>`).join('') || '—'}</div>
      <div><h3>${t('by_zone')}</h3>
        ${s.tiers.map((x) => `<div class="pay-row"><span class="tier"><i style="background:${x.color}"></i>${x.price != null ? baht(x.price) : ''}</span><b>${x.count}</b></div>`).join('') || '—'}</div>
    </div>
    <div class="row wrap">
      <button data-action="csv" data-kind="bookings" data-report="1">${ICON.download} ${t('csv_bookings')}</button>
      <button data-action="csv" data-kind="payments" data-report="1">${ICON.download} ${t('csv_payments')}</button>
    </div>
  </section>`;
}

// ───────── Concert report: the bar's own sheet layout, live, with an Excel download ─────────
const CONCERT_HEADERS = ['h_no', 'h_name', 'h_table', 'h_floor', 'h_people', 'h_price', 'h_sold', 'h_set', 'h_remark', 'h_promo', 'h_paid', 'h_wristband'];
const fmtDateLong = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const concertTitle = () => `${fmtDateLong(S.night)} - ${layoutName(nightLayoutId())}`;
const concertData = () => concertRows(S.bookings, tableById, categoryById);
function viewConcert() {
  const lid = nightLayoutId();
  if (!isConcertLayout(lid)) {
    return `<section><p class="empty">${t('no_concert')}</p>${isManager() ? `<div class="row"><button class="primary" data-action="pick-layout">${ICON.ticket} ${t('pick_night_layout')}</button></div>` : ''}</section>`;
  }
  const { rows, totals } = concertData();
  const free = freeTables(tablesOf(lid), S.bookings);
  const paidN = totals.byPay.paid ?? 0;
  return `<section class="concert">
    <div class="row between wrap toolbar">
      <h2 class="concert-title">${esc(concertTitle())}</h2>
      <button class="primary" data-action="excel">${ICON.download} ${t('download_excel')}</button>
    </div>
    <div class="stats-row">
      <span class="chip"><b>${totals.bookings}</b> ${t('bookings_word')}</span>
      <span class="chip"><b>${totals.people}</b> ${t('people')}</span>
      <span class="chip"><b>${baht(totals.netPrice)}</b> ${t('h_sold')}</span>
      <span class="chip ps-paid"><b>${paidN}</b> ${t('ps_paid')}</span>
      ${totals.bookings - paidN ? `<span class="chip ps-waiting"><b>${totals.bookings - paidN}</b> ${t('f_unpaid')}</span>` : ''}
      <span class="chip"><b>${totals.wristbands}/${totals.bookings}</b> ${t('wristband')}</span>
    </div>
    <div class="sheet-wrap" role="region" aria-label="${t('concert_report')}" tabindex="0">
      <table class="xsheet">
        <thead><tr>${CONCERT_HEADERS.map((k) => `<th>${t(k)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="c">${r.no}</td>
          <td><button class="linkish" data-action="open-booking" data-id="${r.booking.id}">${esc(r.name)}</button> <span class="muted">${esc(r.phone)}</span></td>
          <td class="c"><b>${esc(r.tables)}</b></td>
          <td class="c">${t('floor_' + r.floor) || r.floor}</td>
          <td class="c">${r.party}</td>
          <td class="n">${r.listPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td class="n">${r.netPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td>${esc(r.setDrinks)}</td>
          <td>${esc(r.note)}</td>
          <td>${r.category ? esc(r.category) + (r.discount ? ` ${r.discount}%` : '') : t('na')}</td>
          <td class="pay-cell ps-${r.payStatus}">${t('ps_' + r.payStatus)}</td>
          <td class="c"><button class="wb-check ${r.wristband ? 'on' : ''}" data-action="wristband" data-from="report" data-id="${r.booking.id}" data-v="${r.wristband ? 0 : 1}" aria-pressed="${r.wristband}" aria-label="${t('wristband')} ${esc(r.tables)}">${r.wristband ? ICON.check : ''}</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>${t('total')}</td><td></td><td></td><td class="c">${totals.people}</td>
          <td class="n">${totals.listPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td class="n">${totals.netPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td></td><td></td><td></td><td></td><td class="c">${totals.wristbands}/${totals.bookings}</td></tr></tfoot>
      </table>
    </div>
    ${free.length ? `<p class="muted small-text">${t('free_tables')} (${free.length}): ${free.map((x) => esc(x.label)).join(', ')}</p>` : ''}
    <p class="muted small-text">${t('excel_help')}</p>
  </section>`;
}
async function downloadConcertExcel() {
  try {
    const ExcelJS = await loadExcelJS();
    const { rows, totals } = concertData();
    const labels = {
      headers: CONCERT_HEADERS.map(t), floor: { 1: t('floor_1'), 2: t('floor_2') }, none: t('na'), yes: '✓', total: t('total'),
      pay: Object.fromEntries(PAY_STATUSES.map((p) => [p, t('ps_' + p)])),
    };
    const buf = await concertWorkbook(ExcelJS, { title: concertTitle(), rows, totals, labels, sheetName: layoutName(nightLayoutId()) });
    const name = `${S.night} ${layoutName(nightLayoutId())}.xlsx`.replace(/[\\/:*?"<>|]/g, '');
    download(name, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    log.info('concert.excel', { night: S.night, rows: rows.length });
  } catch (e) { log.error('concert.excel_failed', e); toast(errMsg(e), true); }
}

// ───────── CSV export (opens in Google Sheets: File → Import → Upload) ─────────
function download(name, data, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportCSV(kind, fromReport, days) {
  try {
    let from, to, rows;
    if (fromReport && S.report?.rows) ({ from, to, rows } = S.report);
    else if (kind !== 'guests') {
      to = T.addDays(T.nightOf(Date.now(), S.settings), 60); from = T.addDays(to, -(Number(days || 90) + 60));
      rows = await run(sb.from('bookings').select(BOOKING_SELECT).gte('night', from).lte('night', to).order('start_at'), 'csv.load');
    }
    let csv;
    if (kind === 'bookings') {
      csv = toCSV(rows, [
        { label: 'night', get: (b) => b.night }, { label: 'time', get: (b) => hhmm(b.start_at) },
        { label: 'tables', get: tablesLabel }, { label: 'guest', get: (b) => b.guest_name }, { label: 'phone', get: (b) => b.phone },
        { label: 'party', get: (b) => b.party_size }, { label: 'status', get: (b) => b.status }, { label: 'walk_in', get: (b) => b.is_walk_in },
        { label: 'due', get: dueOfB }, { label: 'paid', get: paidOfB }, { label: 'pay_status', get: (b) => t('ps_' + payOf(b)) },
        { label: 'category', get: (b) => categoryById(b.category_id)?.name ?? '' }, { label: 'wristband', get: (b) => (b.wristband_at ? 'yes' : '') },
        { label: 'note', get: (b) => b.note }, { label: 'created_by', get: (b) => personName(b.created_by) }, { label: 'id', get: (b) => b.id },
      ]);
    } else if (kind === 'payments') {
      const pays = rows.flatMap((b) => (b.booking_payments ?? []).map((p) => ({ ...p, b })));
      csv = toCSV(pays, [
        { label: 'paid_at', get: (p) => stamp(p.created_at) }, { label: 'night', get: (p) => p.b.night }, { label: 'tables', get: (p) => tablesLabel(p.b) },
        { label: 'guest', get: (p) => p.b.guest_name }, { label: 'amount', get: (p) => p.amount }, { label: 'method', get: (p) => p.method },
        { label: 'slip', get: (p) => (p.slip_path ? 'yes' : '') }, { label: 'by', get: (p) => personName(p.created_by) }, { label: 'booking_id', get: (p) => p.booking_id },
      ]);
    } else {
      const guests = await run(sb.from('guests').select('*').order('created_at'), 'csv.guests');
      const stats = await run(sb.from('guest_stats').select('*'), 'csv.guest_stats');
      const byId = new Map(stats.map((x) => [x.guest_id, x]));
      csv = toCSV(guests, [
        { label: 'name', get: (g) => g.name }, { label: 'phone', get: (g) => g.phone }, { label: 'tags', get: (g) => g.tags.join(' ') },
        { label: 'visits', get: (g) => byId.get(g.id)?.visits ?? 0 }, { label: 'no_shows', get: (g) => byId.get(g.id)?.no_shows ?? 0 },
        { label: 'last_visit', get: (g) => byId.get(g.id)?.last_visit ?? '' }, { label: 'note', get: (g) => g.note },
      ]);
    }
    const name = `music-table-${kind}${from ? `-${from}_${to}` : ''}.csv`;
    download(name, csv);
    log.info('csv.exported', { kind, rows: csv.split('\r\n').length - 2 });
  } catch (e) { toast(errMsg(e), true); }
}

// ───────── Modals ─────────
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <button class="icon close" data-action="close-modal" aria-label="${t('close')}">${ICON.close}</button>${html}</div>`;
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function openTable(id) {
  const tb = tableById(id);
  const ms = atMs();
  const list = S.bookings.filter((b) => T.tablesOf(b).includes(id));
  const free = isTonight() && T.tableStateAt(id, S.bookings, Date.now(), TOPTS()).state === 'free';
  openModal(`<h2>${esc(tb.label)} <span class="muted small-text">${t('floor')} ${tb.floor} · ${tb.seats} ${t('seats_short')}${tb.price != null ? ' · ' + baht(tb.price) : ''}</span></h2>
    <div class="list">${list.length ? list.map((b) => b.status === 'booked' && isTonight()
      ? `<div class="row">${bookingRow(b)}<button class="primary small" data-action="set-status" data-id="${b.id}" data-s="seated">${t('arrived')}</button></div>`
      : bookingRow(b)).join('') : `<p class="empty">${t('no_bookings')}</p>`}</div>
    <div class="row wrap">
      <button class="primary" data-action="new-booking" data-table="${id}">${ICON.plus} ${t('new_booking')}</button>
      ${free ? `<button data-action="walk-in" data-table="${id}">${ICON.walk} ${t('walk_in')}</button>` : ''}
    </div>`);
  void ms;
}

function defaultTime(times) {
  if (!isTonight()) return times[0];
  const now = Date.now();
  return times.find((x) => T.nightTimeToMs(S.night, x, S.settings) >= now - 5 * 60000) ?? times[times.length - 1];
}
const tableOptions = (tables, selected, busy) => tables.map((x) =>
  `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${busy(x) ? '● ' : ''}${esc(x.label)} · ${t('floor')} ${x.floor} · ${x.seats} ${t('seats_short')}${x.price != null ? ' · ' + baht(x.price) : ''}${busy(x) ? ' · ' + t('taken') : ''}</option>`).join('');

function bookingForm(b, opts = {}) {
  const lid = nightLayoutId();
  const walk = opts.walkIn || b?.is_walk_in;
  const tables = tablesOf(lid);
  const times = T.slots(S.settings, 15);
  const time = b ? hhmm(b.start_at) : S.at !== 'now' ? S.at : defaultTime(times);
  if (time && !times.includes(time)) times.unshift(time);
  const draftAt = { start_at: new Date(T.nightTimeToMs(S.night, time, S.settings)).toISOString(), duration_min: S.settings.default_duration_min, id: b?.id };
  const busy = (x) => T.conflictsFor({ ...draftAt, table_id: x.id }, S.bookings, TOPTS()).length > 0;
  const tableId = b?.table_id ?? opts.tableId ?? (wide() && tableById(S.selTable)?.layout_id === lid ? S.selTable : null)
    ?? (tables.find((x) => x.floor === S.floor && !busy(x)) ?? tables.find((x) => !busy(x)) ?? tables[0])?.id;
  if (!tables.length) return `<p class="empty">${t('no_tables')}</p>`;
  const priced = isConcertLayout(lid);
  const cats = (S.categories ?? []).filter((c) => c.active || c.id === b?.category_id);
  const catRadio = (id, name, color, disc) => `<label class="chip-radio" style="--c:${esc(color)}"><input type="radio" name="category_id" value="${id}" ${(b?.category_id ?? '') === id ? 'checked' : ''}>
    <span>${esc(name)}${disc ? ` <small>-${disc}%</small>` : ''}</span></label>`;
  return `<h2>${b ? t('edit_booking') : walk ? t('walk_in') : t('new_booking')}</h2>
    <form data-form="booking" class="stack bk-form">
      <input type="hidden" name="id" value="${b?.id ?? ''}">
      <input type="hidden" name="walk" value="${walk ? '1' : ''}">
      <fieldset class="blk">
        <legend>${t('sec_who')}</legend>
        <div class="grid2">
          ${walk ? '' : `<label>${t('phone')}<input name="phone" type="tel" inputmode="tel" value="${esc(b?.phone)}" required maxlength="30" data-input="phone" autocomplete="off"></label>`}
          <label>${t('name')}<input name="guest_name" value="${esc(b?.guest_name)}" ${walk ? '' : 'required'} maxlength="80" autocomplete="off"></label>
        </div>
        <div id="guest-hint"></div>
        ${cats.length ? `<div class="field-label">${t('category')}</div>
        <div class="chip-radios" role="radiogroup" aria-label="${t('category')}">${catRadio('', t('cat_none'), '#ACC1C6', 0)}${cats.map((c) => catRadio(c.id, c.name, c.color, c.discount_pct)).join('')}</div>` : ''}
      </fieldset>
      <fieldset class="blk">
        <legend>${t('sec_when')}</legend>
        <div class="grid2">
          ${opts.walkIn ? '' : `<label>${t('time')}<select name="time" data-change="bk-time">${times.map((x) =>
            `<option ${x === time ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`}
          <div class="stepper-field"><span class="field-label">${t('guests')}</span>
            <div class="stepper">
              <button type="button" class="icon step" data-action="step" data-d="-1" aria-label="${t('decrease')}">${ICON.minus}</button>
              <input name="party_size" type="number" inputmode="numeric" min="1" max="200" value="${b?.party_size ?? tableById(tableId)?.seats ?? 2}" required aria-label="${t('guests')}">
              <button type="button" class="icon step" data-action="step" data-d="1" aria-label="${t('increase')}">${ICON.plusB}</button>
            </div>
          </div>
          ${wholeNight() ? '' : `<label>${t('duration_min')}<input name="duration_min" type="number" min="15" max="720" step="15" value="${b?.duration_min ?? S.settings.default_duration_min}" required></label>`}
        </div>
      </fieldset>
      <fieldset class="blk">
        <legend>${t('sec_where')}</legend>
        <label>${t('table')}<select name="table_id">${tableOptions(tables, tableId, busy)}</select></label>
        <details class="extra-tables" ${b?.extra_table_ids?.length ? 'open' : ''}>
          <summary>${ICON.plus} ${t('combine_tables')}${b?.extra_table_ids?.length ? ` (${b.extra_table_ids.length})` : ''}</summary>
          <div class="check-grid">${tables.map((x) => `<label class="check"><input type="checkbox" name="extra" value="${x.id}" ${b?.extra_table_ids?.includes(x.id) ? 'checked' : ''}>
            ${esc(x.label)}${busy(x) ? ` <span class="muted">· ${t('taken')}</span>` : ''}</label>`).join('')}</div>
        </details>
        ${priced && b ? `<label>${t('sold_price')}<input name="sold_price" type="number" inputmode="numeric" min="0" step="1" value="${b.sold_price ?? ''}" placeholder="${netPriceOf({ ...b, sold_price: null }, tableById, categoryById(b.category_id))}"><span class="hint">${t('sold_price_help')}</span></label>` : ''}
      </fieldset>
      ${priced && !b && !walk ? `<fieldset class="blk">
        <legend>${t('pay_status')}</legend>
        <div class="chip-radios pay-radios" role="radiogroup" aria-label="${t('pay_status')}">${PAY_STATUSES.map((st) =>
          `<label class="chip-radio ps-${st}"><input type="radio" name="pay_status" value="${st}" ${st === 'unpaid' ? 'checked' : ''}><span>${PAY_ICON[st]}${t('ps_' + st)}</span></label>`).join('')}</div>
      </fieldset>` : ''}
      <label>${t('note')}<textarea name="note" rows="2" maxlength="500">${esc(b?.note)}</textarea></label>
      <div id="warnings"></div>
      <button class="primary big" type="submit">${t('save_booking')}</button>
    </form>`;
}

async function saveBooking(form, confirmed) {
  const fd = new FormData(form);
  const f = Object.fromEntries(fd);
  const walk = !!f.walk;
  const existing = f.id ? S.bookings.find((b) => b.id === f.id) : null;
  const startMs = existing && !f.time ? T.startMs(existing)
    : f.time ? T.nightTimeToMs(S.night, f.time, S.settings) : Date.now();
  const start_at = new Date(startMs).toISOString();
  const draft = {
    id: f.id || undefined,
    table_id: f.table_id,
    start_at,
    // Whole-night mode: the booking holds the table until closing.
    duration_min: wholeNight() ? T.minutesToClose(S.night, start_at, S.settings) : Number(f.duration_min),
    party_size: Number(f.party_size),
    guest_name: (f.guest_name ?? '').trim(),
    phone: (f.phone ?? '').trim(),
    note: (f.note ?? '').trim(),
    extra_table_ids: fd.getAll('extra').filter((x) => x !== f.table_id),
  };
  if ('category_id' in f) draft.category_id = f.category_id || null;
  if ('sold_price' in f) draft.sold_price = f.sold_price === '' ? null : Math.round(Number(f.sold_price));
  if (!existing && f.pay_status) draft.pay_status = f.pay_status;
  if (!confirmed) {
    const warns = [];
    for (const c of T.conflictsFor(draft, S.bookings, TOPTS())) {
      warns.push(t('warn_overlap').replace('{name}', c.guest_name || t('walk_in'))
        .replace('{from}', hhmm(c.start_at)).replace('{to}', wholeNight() ? t('until_close') : T.bkkParts(T.endMs(c)).hhmm));
    }
    const seats = T.tablesOf(draft).reduce((n, id) => n + (tableById(id)?.seats ?? 0), 0);
    if (seats && draft.party_size > seats) warns.push(t('warn_seats').replace('{n}', seats));
    if (warns.length) {
      $('#warnings').innerHTML = `<div class="warn">${ICON.warn}<div>${warns.map((w) => `<div>${esc(w)}</div>`).join('')}
        <button type="button" class="primary small" data-action="confirm-save">${t('save_anyway')}</button></div></div>`;
      $('#warnings').scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  try {
    if (existing) {
      await run(sb.from('bookings').update(draft).eq('id', existing.id), 'booking.update');
      log.info('booking.updated', { booking: existing.id, tables: T.tablesOf(draft).length });
    } else {
      delete draft.id;
      await run(sb.from('bookings').insert(walk ? { ...draft, is_walk_in: true, status: 'seated' } : draft), 'booking.insert');
      log.info('booking.created', { walk_in: walk, tables: T.tablesOf(draft).length, party: draft.party_size, pay: draft.pay_status ?? 'unpaid' });
    }
    closeModal();
    toast(t('saved'));
    await loadNight(); render();
  } catch (e) { toast(errMsg(e), true); }
}

// ───────── Booking detail ─────────
// One sheet, top to bottom in the order staff need it: who/where → guest status → payment → wristband → extras.
let openBookingId = null;
const STEPS = ['booked', 'seated', 'done'];
async function openBooking(id) {
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return;
  openBookingId = id;
  const late = isTonight() && T.isLate(b, Date.now());
  const tb = tableById(b.table_id);
  const timeText = wholeNight() ? hhmm(b.start_at) : `${hhmm(b.start_at)}–${T.bkkParts(T.endMs(b)).hhmm}`;
  openModal(`<div data-booking="${b.id}" class="bk-detail">
    <header class="bk-head">
      <div class="bk-table" aria-label="${t('table')}">${esc(tablesLabel(b))}</div>
      <div class="grow">
        <h2>${esc(b.guest_name || t('walk_in'))}</h2>
        <div class="bk-meta">${fmtNight(b.night)} · ${timeText} · ${ICON.person} ${b.party_size} · ${t('floor')} ${tb?.floor ?? ''} ${catChip(b)}
          ${late ? `<span class="pill st-late">${t('late')}</span>` : ''}</div>
      </div>
    </header>
    <div class="row wrap quick">
      ${b.phone ? `<a class="btn" href="tel:${esc(b.phone)}">${ICON.phone} ${esc(b.phone)}</a>` : ''}
      ${T.isActive(b) ? `<button class="ghost" data-action="edit-booking" data-id="${b.id}">${ICON.edit} ${t('edit')}</button>
        <button class="ghost" data-action="move-start" data-id="${b.id}">${ICON.arrow} ${t('move_table')}</button>` : ''}
    </div>
    ${b.note ? `<p class="bk-note">${esc(b.note)}</p>` : ''}
    ${statusSection(b)}
    ${paymentSection(b)}
    ${wristbandSection(b)}
    ${b.phone && T.isActive(b) ? messageSection(b) : ''}
    ${itemsSection(b)}
    <details class="blk fold" data-fold="history">
      <summary>${t('history')} ${ICON.chev}</summary>
      ${b.guest ? `<p id="guest-stats" class="muted small-text"></p>` : ''}
      <p class="muted small-text">${t('created_by')}: ${esc(personName(b.created_by))}</p>
      <div id="history" class="muted">${t('loading')}</div>
    </details>
  </div>`);
  loadSlips(b);
  loadGuestStats(b);
  try {
    const rows = await run(sb.from('booking_history').select('*').eq('booking_id', id).order('changed_at', { ascending: false }), 'load.history');
    const el = $('#history');
    if (el) el.innerHTML = rows.map(historyRow).join('') || '—';
  } catch (e) { toast(errMsg(e), true); }
}

// Guest status as a 3-step track with one big button for the next step.
function statusSection(b) {
  const closed = ['cancelled', 'no_show'].includes(b.status);
  const at = STEPS.indexOf(b.status);
  const track = `<ol class="steps" aria-label="${t('status_title')}">${STEPS.map((st, i) =>
    `<li class="${closed ? '' : i < at ? 'past' : i === at ? 'now' : ''}" ${i === at && !closed ? 'aria-current="step"' : ''}><i>${i < at ? ICON.check : i + 1}</i><span>${t('step_' + st)}</span></li>`).join('')}</ol>`;
  let actions = '';
  if (b.status === 'booked') {
    actions = `<button class="primary big" data-action="set-status" data-id="${b.id}" data-s="seated">${ICON.check} ${t('act_seat')}</button>
      <div class="row minor">
        <button class="ghost small danger" data-action="set-status" data-id="${b.id}" data-s="no_show">${t('act_noshow')}</button>
        <button class="ghost small danger" data-action="set-status" data-id="${b.id}" data-s="cancelled">${t('act_cancel')}</button>
      </div>`;
  } else if (b.status === 'seated') {
    actions = `<button class="primary big" data-action="set-status" data-id="${b.id}" data-s="done">${t('act_done_big')}</button>`;
  } else if (closed) {
    actions = `<p class="closed-as">${t('closed_as').replace('{s}', t('st_' + b.status))}</p>`;
  }
  if (isManager() && b.status !== 'booked') {
    const back = b.status === 'seated' ? ['booked'] : b.status === 'done' ? ['seated', 'booked'] : ['booked'];
    actions += `<div class="undo-row"><span class="muted small-text">${t('undo_status')}</span>${back.map((st) =>
      `<button class="ghost small" data-action="revert-status" data-id="${b.id}" data-s="${st}">${ICON.undo} ${t('st_' + st)}</button>`).join('')}</div>`;
  }
  return `<section class="blk status-blk">
    <h3>${t('status_title')}</h3>
    ${closed ? '' : track}
    ${actions}
  </section>`;
}

// Re-draw an open booking after realtime changes (keeps the sheet in sync with other devices).
function refreshOpenBooking() {
  const el = $('#modal [data-booking]');
  if (el && openBookingId && S.bookings.some((b) => b.id === openBookingId)) {
    const open = [...el.querySelectorAll('details[data-fold][open]')].map((d) => d.dataset.fold);
    openBooking(openBookingId);
    for (const k of open) $(`#modal details[data-fold="${k}"]`)?.setAttribute('open', '');
  }
}
async function reopen(id, fold) {
  await loadNight(); render(); await openBooking(id);
  if (fold) $(`#modal details[data-fold="${fold}"]`)?.setAttribute('open', '');
}

async function loadGuestStats(b) {
  if (!b.guest) return;
  try {
    const st = await run(sb.from('guest_stats').select('*').eq('guest_id', b.guest.id).maybeSingle(), 'load.guest_stats');
    const el = $('#guest-stats');
    if (el && st) el.textContent = t('guest_stats').replace('{v}', st.visits).replace('{n}', st.no_shows) + (st.last_visit ? ' · ' + t('last_visit') + ' ' + fmtNight(st.last_visit) : '');
  } catch { /* logged in run() */ }
}

// LINE messages: the app prepares the text; staff send it in LINE themselves.
function messageSection(b) {
  const status = b.confirmed_at ? t('confirmed_at').replace('{t}', stamp(b.confirmed_at))
    : b.reminded_at ? t('reminded_at').replace('{t}', stamp(b.reminded_at)) : t('not_reminded');
  return `<details class="blk fold msg-card" data-fold="messages">
    <summary>${ICON.send} ${t('messages')} <span class="muted small-text">${status}</span> ${ICON.chev}</summary>
    <div class="row wrap">
      <button class="small" data-action="share" data-id="${b.id}" data-kind="confirm">${ICON.send} ${t('send_confirm')}</button>
      <button class="small" data-action="share" data-id="${b.id}" data-kind="reminder">${ICON.send} ${t('send_reminder')}</button>
      ${b.confirmed_at ? `<button class="ghost small" data-action="mark-confirmed" data-id="${b.id}" data-v="0">${t('undo_confirm')}</button>`
        : `<button class="ghost small" data-action="mark-confirmed" data-id="${b.id}" data-v="1">${t('guest_confirmed')}</button>`}
    </div>
  </details>`;
}
const stamp = (iso) => { const p = T.bkkParts(Date.parse(iso)); return `${fmtNight(p.date)} ${p.hhmm}`; };
function messageText(b, kind) {
  const s = S.settings;
  const due = dueOfB(b), paid = receivedOfB(b);
  return fill(kind === 'confirm' ? s.confirm_template : s.reminder_template, {
    name: b.guest_name, shop: s.shop_name, table: tablesLabel(b), date: fmtNight(b.night),
    time: hhmm(b.start_at), guests: b.party_size, payment: paymentLine(due, paid, getLang()),
    amount: due ? baht(due) : '', remaining: due ? baht(Math.max(0, due - paid)) : '',
  });
}
function openShare(id, kind) {
  const b = S.bookings.find((x) => x.id === id) ?? null;
  if (!b) return;
  const text = messageText(b, kind);
  openModal(`<h2>${kind === 'confirm' ? t('send_confirm') : t('send_reminder')}</h2>
    <p class="muted small-text">${t('share_hint')}</p>
    <textarea id="share-text" rows="8">${esc(text)}</textarea>
    <div class="row wrap">
      <a class="btn primary" id="share-line" href="${lineShareUrl(text)}" target="_blank" rel="noopener" data-action="share-line" data-id="${b.id}">${ICON.send} ${t('open_line')}</a>
      <button data-action="share-copy" data-id="${b.id}">${t('copy')}</button>
      ${navigator.share ? `<button data-action="share-native" data-id="${b.id}">${t('share_other')}</button>` : ''}
    </div>
    <div class="row wrap">
      <button class="ghost" data-action="mark-reminded" data-id="${b.id}">${t('mark_sent')}</button>
      <button class="ghost" data-action="back-to-booking" data-id="${b.id}">${t('back')}</button>
    </div>`);
  $('#share-text').addEventListener('input', (e) => { $('#share-line').href = lineShareUrl(e.target.value); });
  log.info('share.open', { kind, booking: id });
}

// Payment: five big status buttons (one tap), the amounts, and an optional record of money/slips.
function paymentSection(b) {
  const cat = categoryById(b.category_id);
  const list = listPriceOf(b, tableById), net = netPriceOf(b, tableById, cat);
  const extras = (b.booking_items ?? []).reduce((n, i) => n + i.unit_price * i.qty, 0);
  const due = net + extras, paid = paidOfB(b), left = Math.max(0, due - paid);
  const st = payOf(b);
  const pays = [...(b.booking_payments ?? [])].sort((x, y) => x.created_at.localeCompare(y.created_at));
  const money = [];
  if (list) money.push([t('list_price'), baht(list)]);
  if (list && net !== list) money.push([b.sold_price != null ? t('sold_price') : `${t('discount')} ${esc(cat?.name ?? '')} ${cat?.discount_pct ?? 0}%`, b.sold_price != null ? baht(net) : `−${baht(list - net)}`]);
  if (extras) money.push([t('extras'), baht(extras)]);
  return `<section class="blk pay-blk is-${st}">
    <div class="row between"><h3>${t('pay_status')}</h3><span class="muted small-text">${t('ps_help')}</span></div>
    <div class="pay-grid" role="radiogroup" aria-label="${t('pay_status')}">${PAY_STATUSES.map((p) =>
      `<button class="pay-tile ps-${p} ${p === st ? 'on' : ''}" role="radio" aria-checked="${p === st}" data-action="set-pay" data-id="${b.id}" data-s="${p}">${PAY_ICON[p]}<span>${t('ps_' + p)}</span></button>`).join('')}</div>
    ${due || paid ? `<dl class="money">
      ${money.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
      <dt><b>${t('to_pay')}</b></dt><dd><b>${baht(due)}</b></dd>
      ${paid ? `<dt>${t('paid_so_far')}</dt><dd>${baht(paid)}</dd>` : ''}
      ${paid && st !== 'paid' ? `<dt>${t('remaining')}</dt><dd class="${left ? 'c-owed' : ''}"><b>${baht(left)}</b></dd>` : ''}
    </dl>` : ''}
    ${st === 'paid' && paid > 0 && paid < due ? `<p class="pay-warn">${ICON.warn} ${t('pay_mismatch').replace('{n}', baht(due - paid))}</p>` : ''}
    ${pays.length ? `<div class="pay-list">${pays.map((p) => `<div class="pay-row">
      <span class="grow"><b>${baht(p.amount)}</b> · ${t('m_' + p.method)}
        <span class="muted small-text pay-meta">${esc(personName(p.created_by))} · ${stamp(p.created_at)}</span></span>
      ${p.slip_path ? `<a class="slip-thumb" data-slip="${esc(p.slip_path)}" target="_blank" rel="noopener"><img alt="${t('slip')}"></a>` : ''}
      ${isManager() ? `<button class="icon small-icon" data-action="pay-delete" data-id="${p.id}" data-bid="${b.id}" aria-label="${t('delete')}">${ICON.close}</button>` : ''}
    </div>`).join('')}</div>` : ''}
    <details class="fold" data-fold="record">
      <summary>${ICON.camera} ${t('record_money')} ${ICON.chev}</summary>
      <form data-form="payment" class="pay-form">
        <input type="hidden" name="booking_id" value="${b.id}">
        <label>${t('amount')}<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${left || ''}" required></label>
        <label>${t('method')}<select name="method">
          <option value="transfer">${t('m_transfer')}</option><option value="cash">${t('m_cash')}</option><option value="card">${t('m_card')}</option>
        </select></label>
        <label class="btn-file">${ICON.camera}<span id="slip-name">${t('attach_slip')}</span><input type="file" name="slip" accept="image/*" data-change="slip-pick"></label>
        <button class="primary" type="submit">${t('record_payment')}</button>
      </form>
    </details>
  </section>`;
}

// Concert wristband: one big toggle, with the set drinks that come with the table.
function wristbandSection(b) {
  const tbs = T.tablesOf(b).map(tableById).filter(Boolean);
  const sets = tbs.map((x) => x.set_note).filter(Boolean);
  if (!isConcertLayout(nightLayoutId()) && !b.wristband_at && !sets.length) return '';
  const on = !!b.wristband_at;
  return `<section class="blk wb-blk ${on ? 'on' : ''}">
    <div class="row between wrap">
      <div><h3>${ICON.wristband} ${t('wristband')}</h3>
        ${sets.length ? `<div class="muted small-text">${t('set_drinks')}: <b class="c-text">${esc(sets.join(' + '))}</b></div>` : ''}</div>
      <button class="${on ? 'ghost' : 'primary'} wb-toggle" data-action="wristband" data-id="${b.id}" data-v="${on ? 0 : 1}" aria-pressed="${on}">
        ${on ? `${ICON.check} ${t('wb_given')}` : t('wb_give')}</button>
    </div>
    ${on ? `<div class="muted small-text">${stamp(b.wristband_at)} · ${esc(personName(b.wristband_by))}</div>` : `<div class="muted small-text">${t('wb_not')}</div>`}
  </section>`;
}
async function loadSlips() {
  for (const a of document.querySelectorAll('#modal [data-slip]')) {
    try {
      const { data, error } = await sb.storage.from('slips').createSignedUrl(a.dataset.slip, 3600);
      if (error) throw error;
      a.href = data.signedUrl; a.querySelector('img').src = data.signedUrl;
    } catch (e) { log.warn('slip.signed_url_failed', e); }
  }
}

// Shrink a photo to at most 1600px JPEG so uploads stay small on mobile data.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('image'))), 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('err_image'))); };
    img.src = url;
  });
}

async function savePayment(form) {
  const v = Object.fromEntries(new FormData(form));
  const id = v.booking_id, amount = Math.round(Number(v.amount));
  if (!(amount > 0)) return toast(t('err_amount'), true);
  const file = form.slip.files?.[0];
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    let slip_path = null;
    if (file) {
      toast(t('uploading'));
      const blob = await compressImage(file);
      slip_path = `${id}/slip-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('slips').upload(slip_path, blob, { contentType: 'image/jpeg' });
      if (error) { log.error('slip.upload_failed', { code: error.statusCode, message: error.message }); throw error; }
    }
    await run(sb.from('booking_payments').insert({ booking_id: id, amount, method: v.method, slip_path }), 'payment.insert');
    log.info('payment.recorded', { booking: id, amount, method: v.method, slip: !!slip_path });
    toast(t('saved'));
    await reopen(id, 'record');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
}

// Extras: packages / bottles added to a booking.
function itemsSection(b) {
  const items = b.booking_items ?? [];
  const products = (S.products ?? []).filter((p) => p.active);
  return `<details class="blk fold items-card" data-fold="items" ${items.length ? 'open' : ''}>
    <summary>${ICON.plus} ${t('extras')}${items.length ? ` (${items.length})` : ''} ${ICON.chev}</summary>
    ${items.length ? `<div class="pay-list">${items.map((i) => `<div class="pay-row">
      <span class="grow">${esc(i.name)} × ${i.qty}</span><span><b>${baht(i.unit_price * i.qty)}</b></span>
      <button class="icon small-icon" data-action="item-delete" data-id="${i.id}" data-bid="${b.id}" aria-label="${t('delete')}">${ICON.close}</button>
    </div>`).join('')}</div>` : ''}
    ${products.length ? `<form data-form="item" class="pay-form">
      <input type="hidden" name="booking_id" value="${b.id}">
      <label class="grow">${t('product')}<select name="product_id" data-change="product-pick">${products.map((p) =>
        `<option value="${p.id}" data-pp="${p.per_person ? 1 : 0}">${esc(p.name)} · ${baht(p.price)}${p.per_person ? ' / ' + t('per_person') : ''}</option>`).join('')}</select></label>
      <label>${t('qty')}<input name="qty" type="number" min="1" max="500" value="${products[0]?.per_person ? b.party_size : 1}" required></label>
      <button type="submit">${ICON.plus} ${t('add')}</button>
    </form>` : `<p class="muted small-text">${t('no_products')}</p>`}
  </details>`;
}
async function saveItem(form) {
  const v = Object.fromEntries(new FormData(form));
  const p = S.products.find((x) => x.id === v.product_id);
  if (!p) return;
  try {
    await run(sb.from('booking_items').insert({ booking_id: v.booking_id, product_id: p.id, name: p.name, unit_price: p.price, qty: Number(v.qty) }), 'item.insert');
    log.info('item.added', { booking: v.booking_id, product: p.id, qty: Number(v.qty) });
    await reopen(v.booking_id, 'items');
  } catch (e) { toast(errMsg(e), true); }
}

// ───────── Move a booking to another table (tap the new table on the map) ─────────
function startMove(id) {
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return;
  closeModal();
  S.moving = id;
  S.view = 'map';
  S.floor = tableById(b.table_id)?.floor ?? S.floor;
  S.selTable = null;
  render();
}
async function finishMove(tableId) {
  const b = S.bookings.find((x) => x.id === S.moving);
  S.moving = null;
  if (!b || tableId === b.table_id) return render();
  const draft = { ...b, table_id: tableId, extra_table_ids: (b.extra_table_ids ?? []).filter((x) => x !== tableId) };
  const clash = T.conflictsFor(draft, S.bookings, TOPTS());
  if (clash.length && !confirm(t('move_clash').replace('{name}', clash[0].guest_name || t('walk_in')).replace('{time}', hhmm(clash[0].start_at)))) return render();
  try {
    await run(sb.from('bookings').update({ table_id: draft.table_id, extra_table_ids: draft.extra_table_ids }).eq('id', b.id), 'booking.move');
    log.info('booking.moved', { booking: b.id, from: b.table_id, to: tableId });
    toast(t('moved_to').replace('{t}', tableById(tableId)?.label ?? ''));
    await loadNight(); render();
  } catch (e) { toast(errMsg(e), true); render(); }
}

// ───────── Notifications (in-app, optionally also on the device) ─────────
const notesSeen = new Set();
function addNote(kind, text, bookingId) {
  const key = `${kind}:${bookingId}`;
  if (notesSeen.has(key)) return;
  notesSeen.add(key);
  S.notes = [{ id: key, at: Date.now(), kind, text, bookingId, read: false }, ...(S.notes ?? [])].slice(0, 50);
  toast(text);
  if (deviceNotify() && document.visibilityState !== 'visible') {
    try { new Notification('Perfect Strangers', { body: text, tag: key }); } catch (e) { log.warn('notify.device_failed', e); }
  }
  updateBell();
}
const deviceNotify = () => { try { return localStorage.getItem('mt_notify') === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } };
function notifyFromChange(payload) {
  const n = payload.new ?? {}, o = payload.old ?? {};
  if (!S.me || n.night !== S.night && n.night !== T.nightOf(Date.now(), S.settings)) return;
  const who = n.guest_name || t('walk_in');
  const tb = tableById(n.table_id)?.label ?? '';
  if (payload.eventType === 'INSERT' && n.created_by !== S.me.id) addNote('new', t('n_new').replace('{name}', who).replace('{table}', tb).replace('{time}', hhmm(n.start_at)), n.id);
  if (payload.eventType === 'UPDATE' && o.status !== n.status && n.updated_by !== S.me.id) {
    if (n.status === 'cancelled') addNote('cancel', t('n_cancel').replace('{name}', who).replace('{table}', tb), n.id);
    if (n.status === 'seated') addNote('seated', t('n_seated').replace('{name}', who).replace('{table}', tb), n.id);
  }
}
// Runs every minute: late arrivals become notifications and the map moves with the clock.
function tick() {
  if (!S.me?.active || !S.settings) return;
  const now = Date.now();
  if (isTonight()) {
    for (const b of S.bookings) {
      if (T.isLate(b, now)) addNote('late', t('n_late').replace('{name}', b.guest_name || t('walk_in')).replace('{table}', tablesLabel(b)).replace('{n}', Math.round((now - T.startMs(b)) / 60000)), b.id);
    }
  }
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (S.view === 'map' && !drag && !typing && $('#modal').hidden) render();
}
const unreadCount = () => (S.notes ?? []).filter((n) => !n.read).length + (S.toRemind?.length ?? 0);
function bellButton(cls = '') {
  const n = unreadCount();
  return `<button class="bell ${cls}" data-action="notes" aria-label="${t('notifications')}">${ICON.bell}${n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
}
function updateBell() {
  for (const el of document.querySelectorAll('.bell')) el.outerHTML = bellButton(el.classList.contains('rail-item') ? 'rail-item' : '');
}
function openNotes() {
  const rem = S.toRemind ?? [];
  const tonight = T.nightOf(Date.now(), S.settings);
  openModal(`<h2>${t('notifications')}</h2>
    ${rem.length ? `<div class="sec-title">${t('to_remind')} (${rem.length})</div>
      <div class="list">${rem.map((b) => `<button class="brow" data-action="remind-open" data-id="${b.id}" data-night="${b.night}">
        <span class="time">${hhmm(b.start_at)}</span>
        <span class="grow"><strong>${esc(b.guest_name)}</strong> <span class="muted small-text">${b.night === tonight ? t('tonight') : t('tomorrow')} · ${esc(tableById(b.table_id)?.label ?? '')}</span></span>
        <span class="pill unpaid">${t('send_reminder')}</span></button>`).join('')}</div>` : ''}
    <div class="sec-title">${t('recent')}</div>
    ${(S.notes ?? []).length ? `<div class="list">${S.notes.map((n) => `<button class="brow note-${n.kind}" data-action="note-open" data-id="${n.bookingId}">
      <span class="time">${T.bkkParts(n.at).hhmm}</span><span class="grow">${esc(n.text)}</span></button>`).join('')}</div>`
      : `<p class="muted small-text">${t('no_notes')}</p>`}`);
  for (const n of S.notes ?? []) n.read = true;
  updateBell();
}

const FIELDS = ['status', 'pay_status', 'wristband_at', 'category_id', 'sold_price', 'table_id', 'start_at', 'party_size', 'guest_name', 'phone', 'note'];
function fmtField(k, v) {
  if (k === 'status') return t('st_' + v);
  if (k === 'table_id') return tableById(v)?.label ?? '—';
  if (k === 'start_at') return hhmm(v);
  if (k === 'pay_status') return t('ps_' + (v ?? 'unpaid'));
  if (k === 'wristband_at') return v ? t('wb_given') : t('wb_not');
  if (k === 'category_id') return categoryById(v)?.name ?? t('cat_none');
  if (k === 'sold_price') return v == null ? '—' : baht(v);
  return v === '' || v == null ? '—' : String(v);
}
function historyRow(h) {
  const when = T.bkkParts(Date.parse(h.changed_at));
  const who = personName(h.changed_by);
  let what;
  if (h.action === 'insert') what = t('h_created');
  else {
    what = FIELDS.filter((k) => JSON.stringify(h.old_row[k]) !== JSON.stringify(h.new_row[k]))
      .map((k) => `${t('f_' + k)}: ${esc(fmtField(k, h.old_row[k]))} → ${esc(fmtField(k, h.new_row[k]))}`).join('<br>') || t('h_nochange');
  }
  return `<div class="hrow"><div class="small-text">${when.date} ${when.hhmm} · ${esc(who)}</div><div>${what}</div></div>`;
}

async function changeNightLayout(newId) {
  const affected = S.bookings.filter((b) => T.isActive(b) && T.tablesOf(b).some((id) => tableById(id)?.layout_id !== newId));
  if (!affected.length) return applyNightLayout(newId, {});
  const oldIds = [...new Set(affected.flatMap(T.tablesOf))].filter((id) => tableById(id)?.layout_id !== newId);
  const newTables = tablesOf(newId);
  openModal(`<h2>${t('move_title')}</h2>
    <p class="muted">${t('move_hint').replace('{layout}', esc(layoutName(newId)))}</p>
    <form data-form="mapping" class="stack">
      <input type="hidden" name="__layout" value="${newId}">
      ${oldIds.map((oid) => {
        const old = tableById(oid);
        const names = affected.filter((b) => T.tablesOf(b).includes(oid)).map((b) => `${hhmm(b.start_at)} ${b.guest_name || t('walk_in')}`).join(', ');
        const same = newTables.find((x) => x.label === old.label);
        return `<label>${esc(old.label)} <span class="muted small-text">(${esc(names)})</span>
          <select name="${oid}" required><option value="">—</option>${newTables.map((x) =>
            `<option value="${x.id}" ${x.id === same?.id ? 'selected' : ''}>${esc(x.label)} · ${t('floor')} ${x.floor}</option>`).join('')}</select></label>`;
      }).join('')}
      <button class="primary" type="submit">${t('confirm')}</button>
    </form>`);
}
async function applyNightLayout(layoutId, mapping) {
  try {
    await run(sb.rpc('set_night_layout', { p_night: S.night, p_layout: layoutId, p_mapping: mapping }));
    closeModal(); toast(t('saved'));
    await loadNight(); render();
  } catch (e) { toast(errMsg(e), true); render(); }
}

// ───────── Events ─────────
const actions = {
  async lang() { setLang(getLang() === 'th' ? 'en' : 'th'); document.documentElement.lang = getLang(); closeModal(); render(); },
  async logout() { if (!confirmLeaveEdit()) return; closeModal(); await sb.auth.signOut(); S.user = null; S.night = null; boot(); },
  view(el) { if (S.view === 'layouts' && el.dataset.v !== 'layouts' && !confirmLeaveEdit()) return; closeModal(); S.view = el.dataset.v; S.selTable = null; render(); window.scrollTo(0, 0); },
  floor(el) { S.floor = Number(el.dataset.f); render(); },
  'edit-floor'(el) { S.editFloor = Number(el.dataset.f); S.selTable = null; render(); },
  'edit-start'() { startEdit(); },
  'edit-cancel'() { if (confirmLeaveEdit()) { S.selTable = null; render(); } },
  'edit-save'() { return saveEdit(); },
  undo() { if (!S.edit?.undo.length) return; S.edit.redo.push(snapshot()); restore(S.edit.undo.pop()); render(); },
  redo() { if (!S.edit?.redo.length) return; S.edit.undo.push(snapshot()); restore(S.edit.redo.pop()); render(); },
  'room-fit'() {
    const items = S.edit.items.filter((x) => x.floor === S.editFloor);
    if (items.length) change(() => { S.edit.rooms[S.editFloor] = boundsOf(items); });
  },
  async 'night-prev'() { await goNight(T.addDays(S.night, -1)); },
  async 'night-next'() { await goNight(T.addDays(S.night, 1)); },
  async 'night-today'() { await goNight(T.nightOf(Date.now(), S.settings)); },
  'close-modal'() { closeModal(); },
  more() { moreSheet(); },
  filter(el) { S.filter = el.dataset.f; render(); },
  share(el) { openShare(el.dataset.id, el.dataset.kind); },
  'share-line'(el) { log.info('share.line', { booking: el.dataset.id }); },
  async 'share-copy'(el) {
    try { await navigator.clipboard.writeText($('#share-text').value); toast(t('copied')); }
    catch (e) { $('#share-text').select(); log.warn('share.copy_failed', e); toast(t('copy_manual'), true); }
    void el;
  },
  async 'share-native'() {
    try { await navigator.share({ text: $('#share-text').value }); } catch (e) { if (e?.name !== 'AbortError') log.warn('share.native_failed', e); }
  },
  async 'mark-reminded'(el) {
    try {
      await run(sb.from('bookings').update({ reminded_at: new Date().toISOString() }).eq('id', el.dataset.id), 'booking.reminded');
      toast(t('saved')); await reopen(el.dataset.id, 'messages');
    } catch (e) { toast(errMsg(e), true); }
  },
  'back-to-booking'(el) { openBooking(el.dataset.id); },
  async 'mark-confirmed'(el) {
    try {
      await run(sb.from('bookings').update({ confirmed_at: el.dataset.v === '1' ? new Date().toISOString() : null }).eq('id', el.dataset.id), 'booking.confirmed');
      await reopen(el.dataset.id, 'messages');
    } catch (e) { toast(errMsg(e), true); }
  },
  async 'set-pay'(el) {
    const id = el.dataset.id, st = el.dataset.s;
    const b = S.bookings.find((x) => x.id === id);
    if (!b || payOf(b) === st) return;
    try {
      await run(sb.from('bookings').update({ pay_status: st }).eq('id', id), 'booking.pay_status');
      log.info('payment.status', { booking: id, from: payOf(b), to: st });
      toast(`${t('pay_status')}: ${t('ps_' + st)}`);
      await reopen(id);
    } catch (e) { toast(errMsg(e), true); }
  },
  async wristband(el) {
    const id = el.dataset.id, on = el.dataset.v === '1';
    try {
      await run(sb.from('bookings').update({ wristband_at: on ? new Date().toISOString() : null }).eq('id', id), 'booking.wristband');
      log.info('wristband.' + (on ? 'given' : 'undone'), { booking: id });
      if (el.dataset.from === 'report' || el.dataset.from === 'door') { await loadNight(); render(); } else await reopen(id);
    } catch (e) { toast(errMsg(e), true); }
  },
  step(el) {
    const input = el.closest('.stepper').querySelector('input');
    input.value = Math.min(Number(input.max) || 200, Math.max(Number(input.min) || 1, (Number(input.value) || 0) + Number(el.dataset.d)));
  },
  noop() {},
  async checkin(el) {
    const b = S.bookings.find((x) => x.id === el.dataset.id);
    if (!b) return;
    if (owes(b) && !confirm(t('checkin_unpaid').replace('{s}', t('ps_' + payOf(b))))) return;
    const concert = isConcertLayout(nightLayoutId());
    try {
      await run(sb.from('bookings').update({ status: 'seated', ...(concert && !b.wristband_at ? { wristband_at: new Date().toISOString() } : {}) }).eq('id', b.id), 'door.checkin');
      log.info('door.checkin', { booking: b.id, wristband: concert });
      toast(`${t('checkin')}: ${b.guest_name || t('walk_in')} · ${tablesLabel(b)}`);
      await loadNight(); render();
    } catch (e) { toast(errMsg(e), true); }
  },
  'door-filter'(el) { S.doorF = el.dataset.f; render(); },
  async 'revert-status'(el) {
    if (!confirm(t('confirm_revert').replace('{s}', t('st_' + el.dataset.s)))) return;
    try {
      await run(sb.from('bookings').update({ status: el.dataset.s }).eq('id', el.dataset.id), 'booking.revert_status');
      log.warn('booking.status_reverted', { booking: el.dataset.id, to: el.dataset.s });
      toast(t('saved')); await reopen(el.dataset.id);
    } catch (e) { toast(errMsg(e), true); }
  },
  async 'cashup-share'() {
    const text = cashUpText();
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast(t('copied')); } }
    catch (e) { if (e?.name !== 'AbortError') { log.warn('cashup.share_failed', e); window.open(lineShareUrl(text), '_blank', 'noopener'); } }
    log.info('cashup.shared');
  },
  reload() { location.reload(); },
  'pick-layout'() {
    openModal(`<h2>${t('pick_night_layout')}</h2>
      <p class="muted small-text">${fmtNight(S.night)}</p>
      <div class="menu-list">${S.layouts.map((l) => `<button class="menu-item ${l.id === nightLayoutId() ? 'on' : ''}" data-action="choose-layout" data-id="${l.id}" aria-pressed="${l.id === nightLayoutId()}">
        ${isConcertLayout(l.id) ? ICON.ticket : ICON.map}<span class="grow">${esc(l.name)}${l.is_default ? ` <small class="muted">(${t('default')})</small>` : ''}</span>${l.id === nightLayoutId() ? ICON.check : ''}</button>`).join('')}</div>`);
  },
  'choose-layout'(el) { if (el.dataset.id === nightLayoutId()) return closeModal(); closeModal(); changeNightLayout(el.dataset.id); },
  excel() { return downloadConcertExcel(); },
  async 'pay-delete'(el) {
    if (!confirm(t('confirm_delete_payment'))) return;
    try {
      await run(sb.from('booking_payments').delete().eq('id', el.dataset.id), 'payment.delete');
      log.warn('payment.deleted', { payment: el.dataset.id, booking: el.dataset.bid });
      await reopen(el.dataset.bid);
      toast(t('pay_deleted_hint'));
    }
    catch (e) { toast(errMsg(e), true); }
  },
  async 'item-delete'(el) {
    try { await run(sb.from('booking_items').delete().eq('id', el.dataset.id), 'item.delete'); await reopen(el.dataset.bid, 'items'); }
    catch (e) { toast(errMsg(e), true); }
  },
  'move-start'(el) { startMove(el.dataset.id); },
  'move-cancel'() { S.moving = null; render(); },
  notes() { openNotes(); },
  'report-range'(el) { S.reportKey = el.dataset.k; S.report = null; render(); },
  csv(el) { exportCSV(el.dataset.kind, !!el.dataset.report, el.dataset.range); },
  async 'toggle-notify'() {
    try {
      if (deviceNotify()) { localStorage.removeItem('mt_notify'); }
      else {
        const perm = 'Notification' in window ? await Notification.requestPermission() : 'denied';
        if (perm === 'granted') localStorage.setItem('mt_notify', '1');
        else toast(t('notify_denied'), true);
        log.info('notify.permission', { perm });
      }
    } catch (e) { log.warn('notify.toggle_failed', e); }
    render();
  },
  'debug-toggle'() { setDebug(!isDebug()); log.info('debug.toggled', { on: isDebug() }); render(); },
  async 'diag-copy'() {
    const info = { version: VERSION, at: new Date().toISOString(), user: S.me?.id, role: S.me?.role, view: S.view, night: S.night,
      online: navigator.onLine, realtime: S.realtime, ua: navigator.userAgent, logs: recentLogs().slice(-80) };
    try { await navigator.clipboard.writeText(JSON.stringify(info, null, 2)); toast(t('copied')); }
    catch (e) { log.warn('diag.copy_failed', e); toast(t('copy_manual'), true); }
  },
  async 'server-logs'() {
    try {
      await flushLogs();
      const rows = await run(sb.from('app_logs').select('*').order('at', { ascending: false }).limit(40), 'logs.load');
      $('#server-logs').innerHTML = `<div class="sec-title">${t('server_logs')}</div><div class="log-list">${rows.map((r) =>
        logRow({ ...r, event: `${r.event} · ${personName(r.user_id)} · ${r.app_version ?? ''}` })).join('') || '—'}</div>`;
    } catch (e) { toast(errMsg(e), true); }
  },
  async 'remind-open'(el) {
    if (el.dataset.night !== S.night) { S.night = el.dataset.night; await loadNight(); render(); }
    openShare(el.dataset.id, 'reminder');
  },
  async 'note-open'(el) { closeModal(); if (S.bookings.some((b) => b.id === el.dataset.id)) openBooking(el.dataset.id); },
  async 'go-night'(el) { await goNight(el.dataset.d); },
  'at-now'() { S.at = 'now'; render(); },
  unselect() { S.selTable = null; render(); },
  'select-table'(el) { S.selTable = el.dataset.id; S.floor = tableById(el.dataset.id)?.floor ?? S.floor; render(); },
  'new-booking'(el) { openModal(bookingForm(null, { tableId: el.dataset.table })); },
  'walk-in'(el) { openModal(bookingForm(null, { walkIn: true, tableId: el.dataset.table })); },
  'open-booking'(el) { openBooking(el.dataset.id); },
  'edit-booking'(el) { openModal(bookingForm(S.bookings.find((b) => b.id === el.dataset.id))); },
  'confirm-save'() { saveBooking($('form[data-form="booking"]'), true); },
  async 'set-status'(el) {
    try {
      await run(sb.from('bookings').update({ status: el.dataset.s }).eq('id', el.dataset.id));
      closeModal(); toast(t('saved')); await loadNight(); render();
    } catch (e) { toast(errMsg(e), true); }
  },
  'layout-create'() { openCreateLayout(); },
  'layout-menu'() {
    const lay = S.layouts.find((l) => l.id === S.editLayoutId);
    openModal(`<h2>${esc(lay.name)}</h2>
      <div class="menu-list">
        <button class="menu-item" data-action="layout-rename">${ICON.edit}<span>${t('rename')}</span></button>
        ${lay.is_default ? '' : `<button class="menu-item" data-action="layout-default">${ICON.check}<span>${t('make_default')}</span></button>
          <button class="menu-item danger" data-action="layout-delete">${ICON.close}<span>${t('delete')}</span></button>`}
      </div>`);
  },
  'add-open'() {
    openModal(`<h2>${t('add')}</h2>
      <div class="menu-list">
        <button class="menu-item" data-action="table-add">${ICON.plus}<span class="grow">${t('table_add')}</span></button>
        <button class="menu-item" data-action="bulk-open">${ICON.list}<span class="grow">${t('bulk_add')}</span></button>
      </div>
      <div class="sec-title">${t('add_element')}</div>
      <div class="fx-grid">${Object.keys(FIXTURES).map((k) => `<button class="fx-btn" data-action="add-fx" data-k="${k}">${t('fx_' + k)}</button>`).join('')}</div>`);
  },
  'add-fx'(el) { closeModal(); addItem(el.dataset.k); },
  'zone-new'() { openZoneForm(null); },
  'zone-edit'(el) { openZoneForm(Number(el.dataset.i)); },
  'zone-assign'(el) { S.edit.assign = Number(el.dataset.i); S.edit.zonesOpen = true; S.selTable = null; render(); },
  'zone-assign-done'() { S.edit.assign = null; render(); },
  'zone-remove'(el) {
    const z = zonesOf(S.edit.items)[Number(el.dataset.i)];
    closeModal();
    change(() => {
      for (const it of S.edit.items) if (isTable(it) && zoneKey(it) === zoneKey(z)) Object.assign(it, { color: null, price: null, set_note: null });
      S.edit.zones = (S.edit.zones ?? []).filter((x) => zoneKey(x) !== zoneKey(z));
      S.edit.assign = null;
    });
  },
  'bulk-open'() { openBulkAdd(); },
  async 'layout-rename'() {
    closeModal();
    const src = S.layouts.find((l) => l.id === S.editLayoutId);
    const name = prompt(t('layout_name_prompt'), src.name);
    if (!name?.trim()) return;
    try { await run(sb.from('layouts').update({ name: name.trim() }).eq('id', src.id)); await reload(); }
    catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-default'() {
    closeModal();
    try { await run(sb.rpc('set_default_layout', { p_layout: S.editLayoutId })); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-delete'() {
    closeModal();
    if (!confirm(t('confirm_delete_layout'))) return;
    try { await run(sb.from('layouts').delete().eq('id', S.editLayoutId)); S.editLayoutId = null; await reload(); }
    catch (e) { toast(errMsg(e), true); }
  },
  'table-add'() { closeModal(); addItem('table'); },
  'table-remove'(el) {
    const id = el.dataset.id;
    change(() => {
      S.edit.items = S.edit.items.filter((x) => x.id !== id);
      if (!id.startsWith('new-')) S.edit.removed.push(id);
      S.selTable = null;
    });
  },
};

async function goNight(n) {
  S.night = n; S.at = 'now';
  try { await loadNight(); } catch (e) { toast(errMsg(e), true); }
  render();
}

document.addEventListener('click', (e) => {
  const modal = $('#modal');
  if (e.target === modal) return closeModal();
  const tbl = e.target.closest('svg.floor:not(.editor) [data-tid]');
  if (tbl) {
    if (S.moving) return finishMove(tbl.dataset.tid);
    if (wide()) { S.selTable = tbl.dataset.tid; return render(); }
    return openTable(tbl.dataset.tid);
  }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

const changes = {
  async night(el) { if (el.value) await goNight(el.value); },
  at(el) { S.at = el.value; render(); },
  'bk-time'(el) {
    const form = el.form, sel = form.table_id, id = form.id.value || undefined;
    const draftAt = { start_at: new Date(T.nightTimeToMs(S.night, el.value, S.settings)).toISOString(), duration_min: Number(form.duration_min?.value) || S.settings.default_duration_min, id };
    const busy = (x) => T.conflictsFor({ ...draftAt, table_id: x.id }, S.bookings, TOPTS()).length > 0;
    sel.innerHTML = tableOptions(tablesOf(nightLayoutId()), sel.value, busy);
  },
  mode(el) { const d = el.form.querySelector('.duration-field'); if (d) d.hidden = el.value !== 'timed'; },
  'slip-pick'(el) { const f = el.files?.[0]; const n = $('#slip-name'); if (n) n.textContent = f ? f.name.slice(0, 24) : t('attach_slip'); },
  'product-pick'(el) {
    const per = el.selectedOptions[0]?.dataset.pp === '1';
    const b = S.bookings.find((x) => x.id === el.form.booking_id.value);
    el.form.qty.value = per && b ? b.party_size : 1;
  },
  'pick-edit-layout'(el) { if (!confirmLeaveEdit()) { el.value = S.editLayoutId; return; } S.editLayoutId = el.value; S.selTable = null; render(); },
  async 'staff-role'(el) {
    try { await run(sb.from('profiles').update({ role: el.value }).eq('id', el.dataset.id)); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); await reload(); }
  },
  async 'staff-active'(el) {
    try { await run(sb.from('profiles').update({ active: el.checked }).eq('id', el.dataset.id)); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); await reload(); }
  },
};
// Recognise returning guests from their phone number while a booking is typed in.
let phoneTimer = null;
async function lookupGuest(input) {
  const hint = $('#guest-hint');
  const phone = input.value.replace(/[^0-9+]/g, '');
  if (!hint) return;
  if (phone.replace(/\D/g, '').length < 9) { hint.innerHTML = ''; return; }
  try {
    const g = await run(sb.from('guests').select('*').eq('phone', phone).maybeSingle(), 'guest.lookup');
    if (!g) { hint.innerHTML = `<div class="guest-hint muted small-text">${t('new_guest')}</div>`; return; }
    const st = await run(sb.from('guest_stats').select('*').eq('guest_id', g.id).maybeSingle(), 'guest.stats');
    const nameInput = input.form?.guest_name;
    if (nameInput && !nameInput.value.trim() && g.name) nameInput.value = g.name;
    hint.innerHTML = `<div class="guest-hint ${st?.no_shows ? 'warn-soft' : ''}"><b>${t('returning_guest')}</b> ${esc(g.name)}
      <span class="muted small-text">${t('guest_stats').replace('{v}', st?.visits ?? 0).replace('{n}', st?.no_shows ?? 0)}</span></div>`;
  } catch { hint.innerHTML = ''; }
}

document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'q') { S.q = e.target.value; $('#list-rows').innerHTML = listRows(); return; }
  if (e.target.dataset.input === 'door-q') { S.doorQ = e.target.value; $('#door-rows').innerHTML = doorList(); return; }
  if (e.target.dataset.input === 'drawer') {
    const exp = Number(e.target.dataset.expect), v = e.target.value === '' ? null : Number(e.target.value);
    const el = $('#drawer-diff');
    if (v == null) { el.className = 'drawer-diff muted small-text'; el.textContent = t('cash_expected').replace('{n}', baht(exp)); return; }
    const d = v - exp;
    el.className = 'drawer-diff ' + (d === 0 ? 'ok' : d > 0 ? 'over' : 'short');
    el.textContent = d === 0 ? t('cash_match') : (d > 0 ? t('cash_over') : t('cash_short')).replace('{n}', baht(Math.abs(d)));
    return;
  }
  if (e.target.dataset.input === 'phone') { clearTimeout(phoneTimer); phoneTimer = setTimeout(() => lookupGuest(e.target), 350); return; }
  if (e.target.dataset.input !== 'at') return;
  S.at = timeSlots()[Number(e.target.value)];
  $('#at-label').textContent = S.at;
  const wrap = $('#floor-wrap');
  if (wrap) { wrap.innerHTML = mapSvg(); fitFloors(); }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.input === 'at') return render();
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});

const forms = {
  payment(f) { return savePayment(f); },
  item(f) { return saveItem(f); },
  async messages(f) {
    const v = Object.fromEntries(new FormData(f));
    try { await run(sb.from('settings').update({ shop_name: v.shop_name.trim(), confirm_template: v.confirm_template, reminder_template: v.reminder_template }).eq('id', 1), 'settings.messages'); toast(t('saved')); await reload(); }
    catch (e) { toast(errMsg(e), true); }
  },
  async category(f) {
    const v = Object.fromEntries(new FormData(f));
    const row = { name: v.name.trim(), color: v.color, discount_pct: Math.max(0, Math.min(100, Number(v.discount_pct) || 0)), active: !!v.active };
    try {
      if (v.id) await run(sb.from('categories').update(row).eq('id', v.id), 'category.update');
      else await run(sb.from('categories').insert({ ...row, sort: (S.categories?.length ?? 0) + 1 }), 'category.insert');
      toast(t('saved')); await reload();
    } catch (e) { toast(errMsg(e), true); }
  },
  async product(f) {
    const v = Object.fromEntries(new FormData(f));
    const row = { name: v.name.trim(), price: Number(v.price), per_person: !!v.per_person, active: !!v.active };
    try {
      if (v.id) await run(sb.from('products').update(row).eq('id', v.id), 'product.update');
      else await run(sb.from('products').insert(row), 'product.insert');
      toast(t('saved')); await reload();
    } catch (e) { toast(errMsg(e), true); }
  },
  async login(f) {
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { log.warn('auth.login_failed', { code: error.code ?? error.status, message: error.message }); toast(errMsg(error), true); }
  },
  booking(f) { return saveBooking(f, false); },
  'layout-create'(f) { return createLayout(f); },
  zone(f) { saveZone(f); },
  bulk(f) { bulkAdd(f); },
  table(f) {
    const v = Object.fromEntries(new FormData(f));
    const it = draftItem(v.id);
    if (!it) return;
    change(() => {
      Object.assign(it, { label: v.label.trim(), seats: Number(v.seats), shape: v.shape, floor: Number(v.floor), w: Number(v.w), h: Number(v.h) });
      if ('zone' in v) Object.assign(it, v.zone === '' ? { color: null, price: null, set_note: null } : zoneFields(zonesOf(S.edit.items)[Number(v.zone)]));
      S.editFloor = it.floor;
    });
  },
  room(f) {
    const v = Object.fromEntries(new FormData(f));
    const w = Math.max(100, Number(v.w)), h = Math.max(100, Number(v.h));
    change(() => { S.edit.rooms[S.editFloor] = { w, h }; });
  },
  async staff(f) {
    const v = Object.fromEntries(new FormData(f));
    const { data, error } = await sb.functions.invoke('create-staff', { body: v });
    if (error || data?.error) {
      let msg = data?.error;
      try { msg = msg ?? (await error.context.json()).error; } catch { msg = msg ?? error?.message; }
      return toast(errMsg({ message: msg }), true);
    }
    toast(t('saved')); f.reset(); await reload();
  },
  async settings(f) {
    const v = Object.fromEntries(new FormData(f));
    try {
      await run(sb.from('settings').update({ open_time: v.open_time, close_time: v.close_time, booking_mode: v.booking_mode, default_duration_min: Number(v.default_duration_min) }).eq('id', 1), 'settings.hours');
      log.info('settings.booking_mode', { mode: v.booking_mode });
      toast(t('saved')); await reload();
    } catch (e) { toast(errMsg(e), true); }
  },
  mapping(f) {
    const v = Object.fromEntries(new FormData(f));
    const layout = v.__layout; delete v.__layout;
    return applyNightLayout(layout, v);
  },
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(f);
});

// Drag in edit mode: items snap to walls and to neighbours' edges; the corner handle resizes the room.
let drag = null;
function svgPoint(svg, e) {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
const SNAP = 10;
function snapAxis(pos, half, wall, others) {
  // candidates: flush to wall start/end, flush or aligned to neighbours
  const lo = pos - half, hi = pos + half;
  let best = null;
  const consider = (target, edge) => {
    const d = Math.abs(edge - target);
    if (d <= SNAP && (!best || d < best.d)) best = { d, pos: pos + (target - edge) };
  };
  consider(0, lo); consider(wall, hi);
  for (const [a, b] of others) { consider(b, lo); consider(a, hi); consider(a, lo); consider(b, hi); }
  const p = best ? best.pos : Math.round(pos);
  return Math.min(wall - half, Math.max(half, p));
}
document.addEventListener('pointerdown', (e) => {
  if (!S.edit) return;
  const svg = $('#editor-svg');
  if (!svg || !svg.contains(e.target)) return;
  if (S.edit.assign != null) {
    const g = e.target.closest('[data-tid]');
    if (g) { e.preventDefault(); toggleZone(g.dataset.tid); }
    return;
  }
  if (e.target.closest('[data-handle=room]')) {
    drag = { room: true, before: snapshot(), moved: false };
  } else {
    const g = e.target.closest('[data-tid]');
    if (!g) return;
    const it = draftItem(g.dataset.tid);
    if (!it) return;
    const p = svgPoint(svg, e);
    drag = { it, g, dx: p.x - it.x, dy: p.y - it.y, before: snapshot(), moved: false };
    S.selTable = it.id;
  }
  e.target.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const svg = $('#editor-svg');
  const p = svgPoint(svg, e);
  const room = S.edit.rooms[S.editFloor];
  if (drag.room) {
    const items = S.edit.items.filter((x) => x.floor === S.editFloor);
    const min = boundsOf(items);
    room.w = Math.max(min.w - 24, 100, Math.round(p.x));
    room.h = Math.max(min.h - 24, 100, Math.round(p.y));
    drag.moved = true;
    const r = svg.querySelector('rect.room'); r.setAttribute('width', room.w); r.setAttribute('height', room.h);
    const c = svg.querySelector('[data-handle=room] circle'); c.setAttribute('cx', room.w); c.setAttribute('cy', room.h);
    return;
  }
  const { it } = drag, { w, h } = sizeOf(it);
  const others = S.edit.items.filter((x) => x.floor === it.floor && x.id !== it.id).map((x) => ({ ...x, ...sizeOf(x) }));
  const nx = snapAxis(p.x - drag.dx, w / 2, room.w, others.map((o) => [o.x - o.w / 2, o.x + o.w / 2]));
  const ny = snapAxis(p.y - drag.dy, h / 2, room.h, others.map((o) => [o.y - o.h / 2, o.y + o.h / 2]));
  drag.moved = drag.moved || nx !== it.x || ny !== it.y;
  drag.nx = nx; drag.ny = ny;
  drag.g.setAttribute('transform', `translate(${nx - it.x} ${ny - it.y})`);
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) {
    S.edit.undo.push(d.before); S.edit.redo = [];
    if (!d.room) { d.it.x = d.nx; d.it.y = d.ny; }
  }
  render();
});
// Remember whether the zones panel is open across re-renders while editing.
document.addEventListener('toggle', (e) => {
  if (S.edit && e.target.matches?.('details[data-fold=zones]')) S.edit.zonesOpen = e.target.open;
}, true);
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

init();
