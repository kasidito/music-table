// In-memory stand-in for supabase-js, used only by the UI test.
(function () {
  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const db = (window.__db = {
    settings: [{ id: 1, open_time: '18:00:00', close_time: '02:00:00', default_duration_min: 120 }],
    layouts: [{ id: 'L1', name: 'Normal', is_default: true, created_at: '2026-01-01' }],
    tables: [
      { id: 'T1', layout_id: 'L1', floor: 1, label: 'T1', seats: 4, shape: 'square', x: 150, y: 150, archived: false, color: '#D7261E', price: 3300 },
      { id: 'T2', layout_id: 'L1', floor: 1, label: 'T2', seats: 2, shape: 'round', x: 400, y: 150, archived: false },
      { id: 'T3', layout_id: 'L1', floor: 2, label: 'VIP', seats: 8, shape: 'square', x: 300, y: 300, w: 128, h: 64, archived: false },
      { id: 'F1', layout_id: 'L1', floor: 1, kind: 'stage', label: 'STAGE', seats: 0, shape: 'square', x: 300, y: 450, w: 300, h: 150, archived: false },
    ],
    profiles: [
      { id: 'U1', email: 'boss@bar.test', display_name: 'Boss', role: 'manager', active: true, created_at: '2026-01-01' },
      { id: 'U2', email: 'staff@bar.test', display_name: 'Nok', role: 'staff', active: true, created_at: '2026-01-02' },
    ],
    day_layouts: [],
    bookings: [],
    booking_history: [],
  });
  let session = null;
  const listeners = [];
  const t2m = (s) => { const [h, m] = s.slice(0, 5).split(':').map(Number); return h * 60 + m; };
  function nightOf(iso) {
    const s = db.settings[0];
    const d = new Date(Date.parse(iso) + 7 * 3600e3).toISOString();
    let date = d.slice(0, 10);
    if (t2m(s.close_time) < t2m(s.open_time) && t2m(d.slice(11, 16)) < t2m(s.close_time)) {
      const x = new Date(date + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); date = x.toISOString().slice(0, 10);
    }
    return date;
  }
  function logHistory(oldRow, newRow) {
    db.booking_history.push({ id: db.booking_history.length + 1, booking_id: newRow.id, changed_by: session?.user.id,
      changed_at: now(), action: oldRow ? 'update' : 'insert', old_row: oldRow ? { ...oldRow } : null, new_row: { ...newRow } });
  }

  class Query {
    constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.mode = 'many'; this.orderBy = null; }
    select() { return this; }
    eq(k, v) { this.filters.push((r) => String(r[k]) === String(v)); return this; }
    order(k, o) { this.orderBy = [k, o?.ascending !== false]; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return this.exec().then(res, rej); }
    async exec() {
      const rows = db[this.t];
      let out;
      if (this.op === 'insert') {
        const r = { id: uid(), ...this.payload };
        if (this.t === 'bookings') {
          Object.assign(r, { paid: false, paid_at: null, paid_by: null, slip_path: null, status: r.status ?? 'booked', is_walk_in: !!r.is_walk_in, note: r.note ?? '', phone: r.phone ?? '',
            guest_name: r.guest_name ?? '', night: nightOf(r.start_at), created_by: session.user.id, updated_by: session.user.id });
          logHistory(null, r);
        }
        if (this.t === 'layouts') Object.assign(r, { is_default: false, created_at: now() });
        if (this.t === 'tables') Object.assign(r, { archived: false, kind: r.kind ?? 'table' });
        rows.push(r); out = [r];
      } else if (this.op === 'update') {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        for (const r of out) {
          const old = { ...r };
          Object.assign(r, this.payload);
          if (this.t === 'bookings') {
            r.night = nightOf(r.start_at); r.updated_by = session.user.id;
            if (r.paid !== old.paid) { r.paid_at = r.paid ? now() : null; r.paid_by = r.paid ? session.user.id : null; }
            logHistory(old, r);
          }
        }
      } else if (this.op === 'delete') {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        db[this.t] = rows.filter((r) => !out.includes(r));
      } else {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.orderBy) {
          const [k, asc] = this.orderBy;
          out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1));
        }
      }
      out = JSON.parse(JSON.stringify(out));
      if (this.mode === 'single') return out.length ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
      if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }

  const client = {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        const p = db.profiles.find((x) => x.email === email);
        if (!p || password !== 'password123') return { data: null, error: { message: 'Invalid login credentials' } };
        session = { user: { id: p.id, email } };
        listeners.forEach((cb) => cb('SIGNED_IN', session));
        return { data: { session }, error: null };
      },
      async signOut() { session = null; listeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
    },
    from: (t) => new Query(t),
    async rpc(name, a) {
      if (name === 'duplicate_layout') {
        const id = uid();
        db.layouts.push({ id, name: a.p_name, is_default: false, created_at: now() });
        db.tables.filter((x) => x.layout_id === a.p_layout && !x.archived)
          .forEach((x) => db.tables.push({ ...x, id: uid(), layout_id: id }));
        return { data: id, error: null };
      }
      if (name === 'set_default_layout') {
        db.layouts.forEach((l) => (l.is_default = l.id === a.p_layout));
        return { data: null, error: null };
      }
      if (name === 'set_night_layout') {
        db.day_layouts = db.day_layouts.filter((d) => d.night !== a.p_night);
        db.day_layouts.push({ night: a.p_night, layout_id: a.p_layout });
        for (const b of db.bookings) {
          if (b.night === a.p_night && ['booked', 'seated'].includes(b.status) && a.p_mapping[b.table_id]) {
            const old = { ...b }; b.table_id = a.p_mapping[b.table_id]; logHistory(old, b);
          }
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    functions: {
      async invoke(name, { body }) {
        if (body.password.length < 8) return { data: { error: 'password_too_short' }, error: null };
        db.profiles.push({ id: uid(), email: body.email, display_name: body.display_name, role: body.role, active: true, created_at: now() });
        return { data: { id: 'x' }, error: null };
      },
    },
    storage: {
      from: () => ({
        async upload(path, blob) { (window.__slips ||= {})[path] = blob; return { data: { path }, error: null }; },
        async createSignedUrl(path) {
          const blob = window.__slips?.[path];
          return blob ? { data: { signedUrl: URL.createObjectURL(blob) }, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
  window.supabase = { createClient: () => client };
})();
