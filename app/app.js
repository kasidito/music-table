import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { t, getLang, setLang } from './i18n.js';
import * as T from './time.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
  walk: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13" cy="4" r="2"/><path d="M7 21l3-7 3 3v5M10 14l1-5 4 3 3 1M9 9l2-1"/></svg>',
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
const tableLabel = (id) => { const x = tableById(id); return x ? `${x.label} · ${t('floor')} ${x.floor}` : '—'; };

function atMs() {
  if (S.at === 'now' && isTonight()) return Date.now();
  const at = S.at === 'now' ? S.settings.open_time.slice(0, 5) : S.at;
  return T.nightTimeToMs(S.night, at, S.settings);
}

const ERRORS = [
  'table_has_future_bookings', 'need_one_manager', 'unmapped_bookings', 'cannot_delete_default_layout',
  'invalid_status_change', 'table_not_in_night_layout', 'table_archived', 'forbidden',
  'guest_name_required', 'phone_required', 'password_too_short', 'invalid_email',
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
async function run(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// ───────── Data ─────────
async function loadBase() {
  const [s, l, tb, p] = await Promise.all([
    run(sb.from('settings').select('*').single()),
    run(sb.from('layouts').select('*').order('created_at')),
    run(sb.from('tables').select('*')),
    run(sb.from('profiles').select('*').order('created_at')),
  ]);
  S.settings = s; S.layouts = l; S.profiles = p;
  S.tables = tb.map((x) => ({ ...x, x: Number(x.x), y: Number(x.y) }));
  if (!S.layouts.some((x) => x.id === S.editLayoutId)) S.editLayoutId = null;
}
async function loadNight() {
  const [d, b] = await Promise.all([
    run(sb.from('day_layouts').select('*').eq('night', S.night).maybeSingle()),
    run(sb.from('bookings').select('*').eq('night', S.night).order('start_at')),
  ]);
  S.dayLayout = d; S.bookings = b;
}
async function reload() { await loadBase(); await loadNight(); render(); }

let channel = null, reloadTimer = null;
function setupRealtime() {
  if (channel) return;
  channel = sb.channel('db');
  for (const table of ['bookings', 'tables', 'layouts', 'day_layouts', 'settings']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        await loadBase(); await loadNight();
        const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && $('#app').contains(document.activeElement);
        if (!drag && !typing) render();
      }, 300);
    });
  }
  channel.subscribe();
}
function teardownRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

// ───────── Boot ─────────
async function boot() {
  try {
    if (!S.user) { teardownRealtime(); S.me = null; return render(); }
    S.me = await run(sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle());
    if (!S.me?.active) return render();
    await loadBase();
    if (!S.night) S.night = T.nightOf(Date.now(), S.settings);
    await loadNight();
    setupRealtime();
    render();
  } catch (e) { toast(errMsg(e), true); render(); }
}

async function init() {
  document.documentElement.lang = getLang();
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user ?? null;
  sb.auth.onAuthStateChange((_e, session) => {
    const u = session?.user ?? null;
    if (u?.id !== S.user?.id) { S.user = u; setTimeout(boot, 0); }
  });
  await boot();
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
    layouts: viewLayouts, staff: viewStaff, settings: viewSettings,
  }[S.view]();
  app.innerHTML = viewHeader() + `<main>${body}</main>`;
}

const langBtn = () => `<button class="ghost small" data-action="lang">${getLang() === 'th' ? 'EN' : 'ไทย'}</button>`;

function viewLogin() {
  return `<div class="login">
    <div class="login-top">${langBtn()}</div>
    <h1>Music Table</h1>
    <p class="muted">${t('login_hint')}</p>
    <form data-form="login" class="stack">
      <label>${t('email')}<input name="email" type="email" autocomplete="username" required></label>
      <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">${t('login')}</button>
    </form>
  </div>`;
}

function viewInactive() {
  return `<div class="login">
    <h1>Music Table</h1>
    <p>${t('inactive')}</p>
    <button data-action="logout">${t('logout')}</button>
  </div>`;
}

function viewHeader() {
  const tabs = [['map', t('tab_map')], ['list', t('tab_list')], ['summary', t('tab_summary')]];
  if (isManager()) tabs.push(['layouts', t('tab_layouts')], ['staff', t('tab_staff')], ['settings', t('tab_settings')]);
  const nightTools = ['map', 'list', 'summary'].includes(S.view);
  const layoutPicker = isManager()
    ? `<select data-change="night-layout" aria-label="${t('night_layout')}">${S.layouts.map((l) =>
        `<option value="${l.id}" ${l.id === nightLayoutId() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`
    : `<span class="pill">${esc(layoutName(nightLayoutId()))}</span>`;
  return `<header>
    <div class="row between">
      <strong class="brand">Music Table</strong>
      <div class="row">
        <span class="muted small-text">${esc(S.me.display_name)}</span>
        ${langBtn()}
        <button class="icon" data-action="logout" title="${t('logout')}" aria-label="${t('logout')}">${ICON.logout}</button>
      </div>
    </div>
    ${nightTools ? `<div class="row wrap night-row">
      <div class="row datenav">
        <button class="icon" data-action="night-prev" aria-label="${t('prev_night')}">${ICON.left}</button>
        <input type="date" value="${S.night}" data-change="night" aria-label="${t('night')}">
        <button class="icon" data-action="night-next" aria-label="${t('next_night')}">${ICON.right}</button>
        ${isTonight() ? '' : `<button class="ghost small" data-action="night-today">${t('tonight')}</button>`}
      </div>
      <label class="row inline-label">${t('layout')} ${layoutPicker}</label>
    </div>` : ''}
    <nav class="tabs">${tabs.map(([v, label]) =>
      `<button class="tab ${S.view === v ? 'on' : ''}" data-action="view" data-v="${v}">${label}</button>`).join('')}</nav>
  </header>`;
}

// Shared table drawing for the floor map and the layout editor.
const CANVAS = { w: 1200, h: 900 };
const sizeOf = (tb) => ({ w: Number(tb.w) || 64, h: Number(tb.h) || 64 });
function tableSvg(tb, cls, lines) {
  const { w, h } = sizeOf(tb);
  const shape = tb.shape === 'round'
    ? `<ellipse cx="${tb.x}" cy="${tb.y}" rx="${w / 2 - 1}" ry="${h / 2 - 1}"/>`
    : `<rect x="${tb.x - w / 2 + 1}" y="${tb.y - h / 2 + 1}" width="${w - 2}" height="${h - 2}" rx="${isTable(tb) ? 6 : 24}"/>`;
  const fs = Math.max(12, Math.min(18, Math.min(w, h) * 0.3));
  const shown = isTable(tb) ? lines : (['door', 'wall', 'speaker'].includes(tb.kind) ? [] : [tb.label]);
  const text = shown.filter(Boolean).map((l, i, a) =>
    `<text x="${tb.x}" y="${tb.y + (i - (a.length - 1) / 2) * fs * 1.15}" class="${i === 0 ? 'tl' : 'ts'}" font-size="${i === 0 ? fs : fs * 0.72}">${esc(l)}</text>`).join('');
  const kind = isTable(tb) ? 'tbl' : `tbl fx fx-${tb.kind}`;
  const extra = tb.kind === 'speaker' ? `<circle cx="${tb.x}" cy="${tb.y}" r="${Math.min(w, h) / 5}" class="cone"/>` : '';
  return `<g class="${kind} ${cls}" ${isTable(tb) || cls.includes('edit') ? `data-tid="${tb.id}"` : ''}>${shape}${extra}${text}</g>`;
}
const FIXTURES = {
  stage: [240, 140, 'square'], bar: [40, 240, 'square'], speaker: [44, 44, 'square'], door: [20, 80, 'square'],
  stairs: [80, 100, 'square'], restroom: [100, 80, 'square'], dj: [100, 60, 'square'], wall: [200, 12, 'square'],
};
async function addItem(kind) {
  const existing = tablesOf(S.editLayoutId);
  let row;
  if (kind === 'table') {
    let n = existing.length + 1;
    while (existing.some((x) => x.label === `T${n}`)) n++;
    row = { kind, label: `T${n}`, seats: 4, shape: 'square', w: 64, h: 64 };
  } else {
    const [w, h, shape] = FIXTURES[kind];
    row = { kind, label: t('fx_' + kind), seats: 0, shape, w, h };
  }
  const box = $('#editor-svg')?.viewBox.baseVal;
  const x = box ? Math.round(box.x + box.width / 2) : 400, y = box ? Math.round(box.y + box.height / 2) : 300;
  try {
    const saved = await run(sb.from('tables').insert({ ...row, layout_id: S.editLayoutId, floor: S.editFloor, x, y }).select().single());
    S.selTable = saved.id; await reload();
  } catch (e) { toast(errMsg(e), true); }
}
// Fit the drawing to what is on this floor.
function viewBoxFor(items, pad = 24) {
  if (!items.length) return `0 0 800 600`;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const { w, h } = sizeOf(it);
    x0 = Math.min(x0, it.x - w / 2); y0 = Math.min(y0, it.y - h / 2);
    x1 = Math.max(x1, it.x + w / 2); y1 = Math.max(y1, it.y + h / 2);
  }
  return `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
}

function viewMap() {
  const lid = nightLayoutId();
  const tables = tablesOf(lid, S.floor);
  const items = itemsOf(lid, S.floor);
  const ms = atMs();
  const times = T.slots(S.settings, 30);
  const svg = items.map((tb) => {
    if (!isTable(tb)) return tableSvg(tb, '', []);
    const st = T.tableStateAt(tb.id, S.bookings, ms);
    let info = '';
    if (st.booking) info = hhmm(st.booking.start_at);
    else if (st.next) info = `${t('next')} ${hhmm(st.next.start_at)}`;
    return tableSvg(tb, 'st-' + st.state, [tb.label, info]);
  }).join('');
  return `<section>
    <div class="row wrap between toolbar">
      <div class="seg">${[1, 2].map((f) =>
        `<button class="${S.floor === f ? 'on' : ''}" data-action="floor" data-f="${f}">${t('floor')} ${f}</button>`).join('')}</div>
      <label class="row inline-label">${t('at_time')}
        <select data-change="at">
          ${isTonight() ? `<option value="now" ${S.at === 'now' ? 'selected' : ''}>${t('now')}</option>` : ''}
          ${times.map((x) => `<option ${S.at === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </label>
      <button class="primary" data-action="new-booking">${ICON.plus} ${t('new_booking')}</button>
    </div>
    ${tables.length ? `<div class="floor-wrap"><svg class="floor" viewBox="${viewBoxFor(items)}" role="img" aria-label="${t('floor')} ${S.floor}">${svg}</svg></div>`
      : `<p class="empty">${t('no_tables')}${isManager() ? ' ' + t('no_tables_mgr') : ''}</p>`}
    <div class="legend">
      <span><i class="dot free"></i>${t('free')}</span>
      <span><i class="dot booked"></i>${t('st_booked')}</span>
      <span><i class="dot seated"></i>${t('st_seated')}</span>
    </div>
  </section>`;
}

function bookingRow(b) {
  return `<button class="brow st-${b.status}" data-action="open-booking" data-id="${b.id}">
    <span class="time">${hhmm(b.start_at)}</span>
    <span class="grow"><strong>${esc(b.guest_name || t('walk_in'))}</strong>
      <span class="muted small-text"> ${esc(tableLabel(b.table_id))} · ${ICON.person} ${b.party_size}</span>
      ${b.note ? `<span class="muted small-text note">${esc(b.note)}</span>` : ''}</span>
    <span class="pill st-${b.status}">${t('st_' + b.status)}</span>
  </button>`;
}

function viewList() {
  return `<section>
    <div class="row between toolbar">
      <h2>${t('bookings_for')} ${S.night}</h2>
      <button class="primary" data-action="new-booking">${ICON.plus} ${t('new_booking')}</button>
    </div>
    ${S.bookings.length ? `<div class="list">${S.bookings.map(bookingRow).join('')}</div>` : `<p class="empty">${t('no_bookings')}</p>`}
  </section>`;
}

function viewSummary() {
  const s = T.summary(S.bookings);
  const card = (n, label) => `<div class="stat"><div class="num">${n}</div><div class="muted">${label}</div></div>`;
  return `<section>
    <h2>${t('summary_for')} ${S.night}</h2>
    <div class="stats">
      ${card(s.bookings, t('sum_bookings'))}
      ${card(s.guests, t('sum_guests'))}
      ${card(s.walkIns, t('sum_walkins'))}
      ${card(s.cancelled, t('sum_cancelled'))}
      ${card(s.noShows, t('sum_noshows'))}
    </div>
  </section>`;
}

function viewLayouts() {
  if (!S.editLayoutId) S.editLayoutId = nightLayoutId() ?? S.layouts[0]?.id;
  const lay = S.layouts.find((l) => l.id === S.editLayoutId);
  if (!lay) return `<section><button class="primary" data-action="layout-new">${ICON.plus} ${t('layout_new')}</button></section>`;
  const items = itemsOf(lay.id, S.editFloor);
  const sel = tableById(S.selTable);
  const selOk = sel && sel.layout_id === lay.id && !sel.archived;
  return `<section>
    <div class="row wrap toolbar">
      <select data-change="edit-layout">${S.layouts.map((l) =>
        `<option value="${l.id}" ${l.id === lay.id ? 'selected' : ''}>${esc(l.name)}${l.is_default ? ' (' + t('default') + ')' : ''}</option>`).join('')}</select>
      <button class="ghost small" data-action="layout-new">${t('layout_new')}</button>
      <button class="ghost small" data-action="layout-dup">${t('layout_dup')}</button>
      <button class="ghost small" data-action="layout-rename">${t('rename')}</button>
      ${lay.is_default ? '' : `<button class="ghost small" data-action="layout-default">${t('make_default')}</button>
        <button class="ghost small danger" data-action="layout-delete">${t('delete')}</button>`}
    </div>
    <div class="row wrap between toolbar">
      <div class="seg">${[1, 2].map((f) =>
        `<button class="${S.editFloor === f ? 'on' : ''}" data-action="edit-floor" data-f="${f}">${t('floor')} ${f}</button>`).join('')}</div>
      <div class="row">
        <button class="primary" data-action="table-add">${ICON.plus} ${t('table_add')}</button>
        <select data-change="add-element" aria-label="${t('add_element')}">
          <option value="">+ ${t('add_element')}</option>
          ${Object.keys(FIXTURES).map((k) => `<option value="${k}">${t('fx_' + k)}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="muted small-text">${t('drag_hint')}</p>
    <div class="floor-wrap"><svg id="editor-svg" class="floor editor" viewBox="${viewBoxFor(items, 80)}">
      ${items.map((tb) => tableSvg(tb, 'edit' + (tb.id === S.selTable ? ' sel' : ''), [tb.label, `${tb.seats} ${t('seats_short')}`])).join('')}
    </svg></div>
    ${selOk ? `<form data-form="table" class="panel stack">
      <input type="hidden" name="id" value="${sel.id}">
      <div class="grid2">
        <label>${t('table_name')}<input name="label" value="${esc(sel.label)}" required maxlength="20"></label>
        ${isTable(sel) ? `<label>${t('seats')}<input name="seats" type="number" min="1" max="50" value="${sel.seats}" required></label>` : `<input type="hidden" name="seats" value="0">`}
        <label>${t('width')}<input name="w" type="number" min="10" max="1000" step="1" value="${sizeOf(sel).w}" required></label>
        <label>${t('height')}<input name="h" type="number" min="10" max="1000" step="1" value="${sizeOf(sel).h}" required></label>
        <label>${t('shape')}<select name="shape">
          <option value="square" ${sel.shape === 'square' ? 'selected' : ''}>${t('square')}</option>
          <option value="round" ${sel.shape === 'round' ? 'selected' : ''}>${t('round')}</option></select></label>
        <label>${t('floor')}<select name="floor">${[1, 2].map((f) => `<option ${sel.floor === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <button class="primary" type="submit">${t('save')}</button>
        <button class="ghost danger" type="button" data-action="table-remove" data-id="${sel.id}">${t('remove_table')}</button>
      </div>
    </form>` : ''}
  </section>`;
}

function viewStaff() {
  return `<section>
    <h2>${t('tab_staff')}</h2>
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
  return `<section>
    <h2>${t('tab_settings')}</h2>
    <form data-form="settings" class="panel stack">
      <div class="grid2">
        <label>${t('open_time')}<input name="open_time" type="time" value="${s.open_time.slice(0, 5)}" required></label>
        <label>${t('close_time')}<input name="close_time" type="time" value="${s.close_time.slice(0, 5)}" required></label>
        <label>${t('default_duration')}<input name="default_duration_min" type="number" min="15" max="720" step="15" value="${s.default_duration_min}" required></label>
      </div>
      <p class="muted small-text">${t('night_rule')}</p>
      <button class="primary" type="submit">${t('save')}</button>
    </form>
  </section>`;
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
  const list = S.bookings.filter((b) => b.table_id === id);
  const free = isTonight() && T.tableStateAt(id, S.bookings, Date.now()).state === 'free';
  openModal(`<h2>${esc(tb.label)} <span class="muted small-text">${t('floor')} ${tb.floor} · ${tb.seats} ${t('seats_short')}</span></h2>
    <div class="list">${list.length ? list.map(bookingRow).join('') : `<p class="empty">${t('no_bookings')}</p>`}</div>
    <div class="row wrap">
      <button class="primary" data-action="new-booking" data-table="${id}">${ICON.plus} ${t('new_booking')}</button>
      ${free ? `<button data-action="walk-in" data-table="${id}">${ICON.walk} ${t('walk_in')}</button>` : ''}
    </div>`);
  void ms;
}

function bookingForm(b, opts = {}) {
  const lid = nightLayoutId();
  const walk = opts.walkIn || b?.is_walk_in;
  const tables = tablesOf(lid);
  const time = b ? hhmm(b.start_at) : (S.at !== 'now' ? S.at : null);
  const times = T.slots(S.settings, 15);
  if (time && !times.includes(time)) times.unshift(time);
  const tableId = b?.table_id ?? opts.tableId ?? tables[0]?.id;
  if (!tables.length) return `<p class="empty">${t('no_tables')}</p>`;
  return `<h2>${b ? t('edit_booking') : walk ? t('walk_in') : t('new_booking')}</h2>
    <form data-form="booking" class="stack">
      <input type="hidden" name="id" value="${b?.id ?? ''}">
      <input type="hidden" name="walk" value="${walk ? '1' : ''}">
      <div class="grid2">
        <label>${t('name')}<input name="guest_name" value="${esc(b?.guest_name)}" ${walk ? '' : 'required'} maxlength="80"></label>
        ${walk ? '' : `<label>${t('phone')}<input name="phone" type="tel" value="${esc(b?.phone)}" required maxlength="30"></label>`}
        <label>${t('guests')}<input name="party_size" type="number" min="1" max="200" value="${b?.party_size ?? 2}" required></label>
        ${opts.walkIn ? '' : `<label>${t('time')}<select name="time">${times.map((x) =>
          `<option ${x === time ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`}
        <label>${t('duration_min')}<input name="duration_min" type="number" min="15" max="720" step="15" value="${b?.duration_min ?? S.settings.default_duration_min}" required></label>
        <label>${t('table')}<select name="table_id">${tables.map((x) =>
          `<option value="${x.id}" ${x.id === tableId ? 'selected' : ''}>${esc(x.label)} · ${t('floor')} ${x.floor} · ${x.seats} ${t('seats_short')}</option>`).join('')}</select></label>
      </div>
      <label>${t('note')}<textarea name="note" rows="2" maxlength="500">${esc(b?.note)}</textarea></label>
      <div id="warnings"></div>
      <button class="primary" type="submit">${t('save')}</button>
    </form>`;
}

async function saveBooking(form, confirmed) {
  const f = Object.fromEntries(new FormData(form));
  const walk = !!f.walk;
  const existing = f.id ? S.bookings.find((b) => b.id === f.id) : null;
  const startMs = existing && !f.time ? T.startMs(existing)
    : f.time ? T.nightTimeToMs(S.night, f.time, S.settings) : Date.now();
  const draft = {
    id: f.id || undefined,
    table_id: f.table_id,
    start_at: new Date(startMs).toISOString(),
    duration_min: Number(f.duration_min),
    party_size: Number(f.party_size),
    guest_name: (f.guest_name ?? '').trim(),
    phone: (f.phone ?? '').trim(),
    note: (f.note ?? '').trim(),
  };
  if (!confirmed) {
    const warns = [];
    for (const c of T.conflictsFor(draft, S.bookings)) {
      warns.push(t('warn_overlap').replace('{name}', c.guest_name || t('walk_in'))
        .replace('{from}', hhmm(c.start_at)).replace('{to}', T.bkkParts(T.endMs(c)).hhmm));
    }
    const tb = tableById(draft.table_id);
    if (tb && draft.party_size > tb.seats) warns.push(t('warn_seats').replace('{n}', tb.seats));
    if (warns.length) {
      $('#warnings').innerHTML = `<div class="warn">${ICON.warn}<div>${warns.map((w) => `<div>${esc(w)}</div>`).join('')}
        <button type="button" class="primary small" data-action="confirm-save">${t('save_anyway')}</button></div></div>`;
      return;
    }
  }
  try {
    if (existing) {
      await run(sb.from('bookings').update(draft).eq('id', existing.id));
    } else {
      delete draft.id;
      await run(sb.from('bookings').insert(walk ? { ...draft, is_walk_in: true, status: 'seated' } : draft));
    }
    closeModal();
    toast(t('saved'));
    await loadNight(); render();
  } catch (e) { toast(errMsg(e), true); }
}

async function openBooking(id) {
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return;
  const next = T.NEXT_STATUS[b.status];
  const label = { seated: t('act_seat'), cancelled: t('act_cancel'), no_show: t('act_noshow'), done: t('act_done') };
  openModal(`<h2>${esc(b.guest_name || t('walk_in'))} <span class="pill st-${b.status}">${t('st_' + b.status)}</span></h2>
    <dl class="facts">
      <dt>${t('time')}</dt><dd>${S.night} ${hhmm(b.start_at)}–${T.bkkParts(T.endMs(b)).hhmm}</dd>
      <dt>${t('table')}</dt><dd>${esc(tableLabel(b.table_id))}</dd>
      <dt>${t('guests')}</dt><dd>${b.party_size}</dd>
      ${b.phone ? `<dt>${t('phone')}</dt><dd><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></dd>` : ''}
      ${b.note ? `<dt>${t('note')}</dt><dd>${esc(b.note)}</dd>` : ''}
      <dt>${t('created_by')}</dt><dd>${esc(personName(b.created_by))}</dd>
      <dt>${t('updated_by')}</dt><dd>${esc(personName(b.updated_by))}</dd>
    </dl>
    <div class="row wrap">
      ${next.map((s) => `<button class="${s === 'seated' || s === 'done' ? 'primary' : s === 'cancelled' || s === 'no_show' ? 'ghost danger' : ''}" data-action="set-status" data-id="${b.id}" data-s="${s}">${label[s]}</button>`).join('')}
      ${T.isActive(b) ? `<button class="ghost" data-action="edit-booking" data-id="${b.id}">${t('edit')}</button>` : ''}
    </div>
    <h3>${t('history')}</h3>
    <div id="history" class="muted">${t('loading')}</div>`);
  try {
    const rows = await run(sb.from('booking_history').select('*').eq('booking_id', id).order('changed_at', { ascending: false }));
    const el = $('#history');
    if (el) el.innerHTML = rows.map(historyRow).join('') || '—';
  } catch (e) { toast(errMsg(e), true); }
}

const FIELDS = ['status', 'table_id', 'start_at', 'duration_min', 'party_size', 'guest_name', 'phone', 'note'];
function fmtField(k, v) {
  if (k === 'status') return t('st_' + v);
  if (k === 'table_id') return tableById(v)?.label ?? '—';
  if (k === 'start_at') return hhmm(v);
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
  const affected = S.bookings.filter((b) => T.isActive(b) && tableById(b.table_id)?.layout_id !== newId);
  if (!affected.length) return applyNightLayout(newId, {});
  const oldIds = [...new Set(affected.map((b) => b.table_id))];
  const newTables = tablesOf(newId);
  openModal(`<h2>${t('move_title')}</h2>
    <p class="muted">${t('move_hint').replace('{layout}', esc(layoutName(newId)))}</p>
    <form data-form="mapping" class="stack">
      <input type="hidden" name="__layout" value="${newId}">
      ${oldIds.map((oid) => {
        const old = tableById(oid);
        const names = affected.filter((b) => b.table_id === oid).map((b) => `${hhmm(b.start_at)} ${b.guest_name || t('walk_in')}`).join(', ');
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
  async lang() { setLang(getLang() === 'th' ? 'en' : 'th'); document.documentElement.lang = getLang(); render(); },
  async logout() { await sb.auth.signOut(); S.user = null; S.night = null; boot(); },
  view(el) { S.view = el.dataset.v; S.selTable = null; render(); },
  floor(el) { S.floor = Number(el.dataset.f); render(); },
  'edit-floor'(el) { S.editFloor = Number(el.dataset.f); S.selTable = null; render(); },
  async 'night-prev'() { await goNight(T.addDays(S.night, -1)); },
  async 'night-next'() { await goNight(T.addDays(S.night, 1)); },
  async 'night-today'() { await goNight(T.nightOf(Date.now(), S.settings)); },
  'close-modal'() { closeModal(); },
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
  async 'layout-new'() {
    const name = prompt(t('layout_name_prompt'));
    if (!name?.trim()) return;
    try {
      const row = await run(sb.from('layouts').insert({ name: name.trim() }).select().single());
      S.editLayoutId = row.id; await reload();
    } catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-dup'() {
    const src = S.layouts.find((l) => l.id === S.editLayoutId);
    const name = prompt(t('layout_name_prompt'), `${src.name} 2`);
    if (!name?.trim()) return;
    try {
      S.editLayoutId = await run(sb.rpc('duplicate_layout', { p_layout: src.id, p_name: name.trim() }));
      await reload();
    } catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-rename'() {
    const src = S.layouts.find((l) => l.id === S.editLayoutId);
    const name = prompt(t('layout_name_prompt'), src.name);
    if (!name?.trim()) return;
    try { await run(sb.from('layouts').update({ name: name.trim() }).eq('id', src.id)); await reload(); }
    catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-default'() {
    try { await run(sb.rpc('set_default_layout', { p_layout: S.editLayoutId })); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); }
  },
  async 'layout-delete'() {
    if (!confirm(t('confirm_delete_layout'))) return;
    try { await run(sb.from('layouts').delete().eq('id', S.editLayoutId)); S.editLayoutId = null; await reload(); }
    catch (e) { toast(errMsg(e), true); }
  },
  'table-add'() { return addItem('table'); },
  async 'table-remove'(el) {
    if (!confirm(t('confirm_remove_table'))) return;
    try { await run(sb.from('tables').update({ archived: true }).eq('id', el.dataset.id)); S.selTable = null; await reload(); }
    catch (e) { toast(errMsg(e), true); }
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
  if (tbl) return openTable(tbl.dataset.tid);
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

const changes = {
  async night(el) { if (el.value) await goNight(el.value); },
  at(el) { S.at = el.value; render(); },
  'night-layout'(el) { changeNightLayout(el.value); },
  'add-element'(el) { const k = el.value; el.value = ''; if (k) addItem(k); },
  'edit-layout'(el) { S.editLayoutId = el.value; S.selTable = null; render(); },
  async 'staff-role'(el) {
    try { await run(sb.from('profiles').update({ role: el.value }).eq('id', el.dataset.id)); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); await reload(); }
  },
  async 'staff-active'(el) {
    try { await run(sb.from('profiles').update({ active: el.checked }).eq('id', el.dataset.id)); await reload(); toast(t('saved')); }
    catch (e) { toast(errMsg(e), true); await reload(); }
  },
};
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});

const forms = {
  async login(f) {
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) toast(errMsg(error), true);
  },
  booking(f) { return saveBooking(f, false); },
  async table(f) {
    const v = Object.fromEntries(new FormData(f));
    try {
      await run(sb.from('tables').update({ label: v.label.trim(), seats: Number(v.seats), shape: v.shape, floor: Number(v.floor), w: Number(v.w), h: Number(v.h) }).eq('id', v.id));
      S.editFloor = Number(v.floor); toast(t('saved')); await reload();
    } catch (e) { toast(errMsg(e), true); }
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
      await run(sb.from('settings').update({ open_time: v.open_time, close_time: v.close_time, default_duration_min: Number(v.default_duration_min) }).eq('id', 1));
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

// Drag tables in the layout editor.
let drag = null;
function svgPoint(svg, e) {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
document.addEventListener('pointerdown', (e) => {
  const g = e.target.closest('#editor-svg [data-tid]');
  if (!g) return;
  const tb = tableById(g.dataset.tid);
  const p = svgPoint($('#editor-svg'), e);
  drag = { g, tb, dx: p.x - tb.x, dy: p.y - tb.y, nx: tb.x, ny: tb.y, moved: false };
  g.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = svgPoint($('#editor-svg'), e);
  const { w: sw, h: sh } = sizeOf(drag.tb);
  const snap = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
  drag.nx = snap(p.x - drag.dx, sw / 2, CANVAS.w - sw / 2);
  drag.ny = snap(p.y - drag.dy, sh / 2, CANVAS.h - sh / 2);
  drag.moved = drag.moved || drag.nx !== drag.tb.x || drag.ny !== drag.tb.y;
  drag.g.setAttribute('transform', `translate(${drag.nx - drag.tb.x} ${drag.ny - drag.tb.y})`);
});
document.addEventListener('pointerup', async () => {
  if (!drag) return;
  const d = drag; drag = null;
  S.selTable = d.tb.id;
  if (d.moved) {
    d.tb.x = d.nx; d.tb.y = d.ny;
    render();
    try { await run(sb.from('tables').update({ x: d.nx, y: d.ny }).eq('id', d.tb.id)); }
    catch (e) { toast(errMsg(e), true); await reload(); }
  } else render();
});

init();
