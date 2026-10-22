// Structured client logging.
// - Levels: debug < info < warn < error. Every entry goes into an in-memory ring buffer (shown in Diagnostics).
// - Console: warn/error always; debug/info only in debug mode (?debug=1 or localStorage mt_debug=1).
// - Server: warn/error are batched to the app_logs table (rate-limited). Personal data keys are redacted.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const BUFFER_MAX = 300;
const REMOTE_MAX_PER_MIN = 30;
const FLUSH_MS = 4000;
const REDACT = /^(phone|guest_name|name|note|email|password|token|access_token|refresh_token|signedUrl)$/i;

const buffer = [];
let queue = [];
let sender = null;
let meta = { version: 'dev' };
let sentThisMinute = 0;
let minuteStart = Date.now();
let flushTimer = null;

function readDebugFlag() {
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') localStorage.setItem('mt_debug', '1');
    return localStorage.getItem('mt_debug') === '1';
  } catch { return false; }
}
let debugMode = typeof location !== 'undefined' && readDebugFlag();

export function setDebug(on) {
  debugMode = !!on;
  try { on ? localStorage.setItem('mt_debug', '1') : localStorage.removeItem('mt_debug'); } catch { /* storage unavailable */ }
}
export const isDebug = () => debugMode;

// Remove personal data and keep context small and JSON-safe.
export function sanitize(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: String(value.stack ?? '').split('\n').slice(0, 6).join('\n') };
  if (depth > 3) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) out[k] = REDACT.test(k) ? '[redacted]' : sanitize(v, depth + 1);
    return out;
  }
  return String(value);
}

function write(level, event, detail) {
  const context = detail === undefined ? {} : typeof detail === 'string' ? { message: detail } : sanitize(detail);
  const message = typeof detail === 'string' ? detail
    : detail instanceof Error ? detail.message
    : (detail && (detail.message || detail.error?.message)) || '';
  const entry = { at: new Date().toISOString(), level, event, message: String(message).slice(0, 2000), context };
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.shift();

  if (LEVELS[level] >= LEVELS.warn || debugMode) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level}] ${event}`, context);
  }
  if (LEVELS[level] >= LEVELS.warn && sender) {
    queue.push(entry);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }
  return entry;
}

export const log = {
  debug: (event, detail) => write('debug', event, detail),
  info: (event, detail) => write('info', event, detail),
  warn: (event, detail) => write('warn', event, detail),
  error: (event, detail) => write('error', event, detail),
};

export const recent = () => buffer.slice();

// send(rows) must insert rows into app_logs; it is set once the user is signed in.
export function configure({ send, version } = {}) {
  if (send !== undefined) sender = send;
  if (version) meta.version = version;
  if (sender && queue.length && !flushTimer) flushTimer = setTimeout(flush, 0);
}

export async function flush() {
  flushTimer = null;
  if (!sender || !queue.length) return;
  if (Date.now() - minuteStart > 60000) { minuteStart = Date.now(); sentThisMinute = 0; }
  const room = Math.max(0, REMOTE_MAX_PER_MIN - sentThisMinute);
  const batch = queue.splice(0, room);
  if (queue.length && !room) { queue = queue.slice(-50); flushTimer = setTimeout(flush, 15000); }
  if (!batch.length) return;
  sentThisMinute += batch.length;
  const rows = batch.map((e) => ({
    level: e.level === 'debug' ? 'info' : e.level,
    event: e.event.slice(0, 80),
    message: e.message,
    context: e.context,
    app_version: meta.version,
    url: typeof location !== 'undefined' ? location.pathname + location.hash : '',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
  }));
  try { await sender(rows); }
  catch (e) { console.warn('[log] could not send logs', e?.message); }
}

export function installGlobalHandlers() {
  window.addEventListener('error', (e) => log.error('window.error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno, error: e.error }));
  window.addEventListener('unhandledrejection', (e) => log.error('promise.unhandled', { error: e.reason instanceof Error ? e.reason : String(e.reason) }));
  window.addEventListener('pagehide', () => { flush(); });
}
