-- 009: guests, deposits/partial payments, extras (packages), reminders, multi-table bookings, app logs.

-- ───────── Guests (one per phone number) ─────────
create function public.norm_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g'), '')
$$;

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+?[0-9]{6,20}$'),
  name text not null default '' check (length(name) <= 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now()
);

alter table public.bookings
  add column guest_id uuid references public.guests(id) on delete set null,
  add column extra_table_ids uuid[] not null default '{}' check (cardinality(extra_table_ids) <= 10),
  add column reminded_at timestamptz,
  add column confirmed_at timestamptz,
  add column amount_paid int not null default 0;
create index bookings_guest_idx on public.bookings (guest_id);

-- Visits / no-shows per guest (respects bookings RLS through security_invoker).
create view public.guest_stats with (security_invoker = true) as
  select g.id as guest_id,
    count(b.id) filter (where b.status in ('seated', 'done')) as visits,
    count(b.id) filter (where b.status = 'no_show') as no_shows,
    count(b.id) filter (where b.status = 'cancelled') as cancellations,
    max(b.night) filter (where b.status in ('seated', 'done')) as last_visit
  from public.guests g left join public.bookings b on b.guest_id = g.id
  group by g.id;

-- ───────── Products (packages / extras) and booking items ─────────
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  price int not null check (price between 0 and 1000000),
  per_person boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 80),
  unit_price int not null check (unit_price between 0 and 1000000),
  qty int not null check (qty between 1 and 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index booking_items_booking_idx on public.booking_items (booking_id);

-- ───────── Payments (deposits, partial, full) ─────────
create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  amount int not null check (amount between 1 and 10000000),
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'card')),
  slip_path text check (slip_path is null or slip_path ~ '^[0-9a-f-]{36}/[0-9A-Za-z._-]+$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index booking_payments_booking_idx on public.booking_payments (booking_id);

-- Clients can't fake who created a row; migrations (no auth.uid) keep what they pass.
create function public.stamp_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := case when auth.uid() is null then coalesce(new.created_at, now()) else now() end;
  return new;
end $$;
create trigger booking_payments_stamp before insert on public.booking_payments
  for each row execute function public.stamp_created_by();
create trigger booking_items_stamp before insert on public.booking_items
  for each row execute function public.stamp_created_by();

-- Amount due = price of every table on the booking + its items.
create function public.booking_due(p_booking uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (
    coalesce((select sum(t.price) from public.bookings b
              join public.tables t on t.id = b.table_id or t.id = any (b.extra_table_ids)
              where b.id = p_booking), 0)
    + coalesce((select sum(i.unit_price * i.qty) from public.booking_items i where i.booking_id = p_booking), 0)
  )::int
$$;

-- Keep bookings.amount_paid / paid in step with payments. Only this function may change them.
create function public.recompute_payment(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  got int;
  due int;
  full_paid boolean;
begin
  select coalesce(sum(amount), 0) into got from public.booking_payments where booking_id = p_booking;
  due := public.booking_due(p_booking);
  full_paid := got > 0 and got >= due;
  perform set_config('app.recompute', '1', true);
  update public.bookings set amount_paid = got, paid = full_paid
  where id = p_booking and (amount_paid is distinct from got or paid is distinct from full_paid);
  perform set_config('app.recompute', '', true);
end $$;

create function public.payments_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_payment(coalesce(new.booking_id, old.booking_id));
  return null;
end $$;
create trigger booking_payments_changed after insert or update or delete on public.booking_payments
  for each row execute function public.payments_changed();
create trigger booking_items_changed after insert or update or delete on public.booking_items
  for each row execute function public.payments_changed();

create function public.bookings_tables_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_payment(new.id);
  return null;
end $$;
create trigger bookings_tables_changed after update of table_id, extra_table_ids on public.bookings
  for each row execute function public.bookings_tables_changed();

-- ───────── Bookings: validation now covers extra tables and protects payment fields ─────────
create or replace function public.bookings_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  allowed text[];
  t record;
begin
  new.night := public.night_of(new.start_at);

  if tg_op = 'INSERT' then
    if new.status not in ('booked', 'seated') then raise exception 'invalid_initial_status'; end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.paid := false;
    new.amount_paid := 0;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.is_walk_in := old.is_walk_in;
    if coalesce(current_setting('app.recompute', true), '') <> '1' then
      new.paid := old.paid;
      new.amount_paid := old.amount_paid;
    end if;
    if new.status <> old.status then
      allowed := case old.status
        when 'booked' then array['seated', 'cancelled', 'no_show']
        when 'seated' then array['done']
        else array[]::text[] end;
      if not (new.status = any (allowed)) then
        raise exception 'invalid_status_change';
      end if;
    end if;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();

  if tg_op = 'INSERT' or new.table_id is distinct from old.table_id or new.night is distinct from old.night then
    select layout_id, archived, kind into t from public.tables where id = new.table_id;
    if t.kind <> 'table' then raise exception 'not_a_table'; end if;
    if t.archived then raise exception 'table_archived'; end if;
    if t.layout_id is distinct from public.layout_for(new.night) then
      raise exception 'table_not_in_night_layout';
    end if;
  end if;

  if tg_op = 'INSERT' or new.extra_table_ids is distinct from old.extra_table_ids or new.night is distinct from old.night then
    if exists (
      select 1 from unnest(new.extra_table_ids) as u(tid)
      left join public.tables et on et.id = u.tid
      where et.id is null or et.kind <> 'table' or et.archived or u.tid = new.table_id
        or et.layout_id is distinct from public.layout_for(new.night)
    ) or cardinality(new.extra_table_ids) <> (select count(distinct u.tid) from unnest(new.extra_table_ids) as u(tid)) then
      raise exception 'invalid_extra_tables';
    end if;
  end if;
  return new;
end $$;

-- Link each booking to a guest by phone number.
create function public.bookings_link_guest() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p text := public.norm_phone(new.phone);
begin
  if p is null or length(regexp_replace(p, '[^0-9]', '', 'g')) < 6 then
    new.guest_id := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and p is not distinct from public.norm_phone(old.phone) and new.guest_id is not null then
    return new;
  end if;
  insert into public.guests (phone, name) values (p, left(coalesce(new.guest_name, ''), 80))
  on conflict (phone) do update set name = case when public.guests.name = '' then excluded.name else public.guests.name end
  returning id into new.guest_id;
  return new;
end $$;
create trigger bookings_link_guest before insert or update of phone, guest_name on public.bookings
  for each row execute function public.bookings_link_guest();

-- Archive guard and night-layout switch also consider extra tables.
create or replace function public.tables_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.layout_id <> old.layout_id then raise exception 'cannot_move_table_between_layouts'; end if;
  if new.archived and not old.archived and exists (
    select 1 from public.bookings b
    where (b.table_id = old.id or old.id = any (b.extra_table_ids)) and b.status in ('booked', 'seated')
      and b.start_at + make_interval(mins => b.duration_min) > now()
  ) then
    raise exception 'table_has_future_bookings';
  end if;
  return new;
end $$;

create or replace function public.set_night_layout(p_night date, p_layout uuid, p_mapping jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;

  insert into public.day_layouts (night, layout_id) values (p_night, p_layout)
  on conflict (night) do update set layout_id = excluded.layout_id;

  update public.bookings b
  set table_id = coalesce((p_mapping->>b.table_id::text)::uuid, b.table_id),
      extra_table_ids = coalesce((select array_agg(coalesce((p_mapping->>u.tid::text)::uuid, u.tid)) from unnest(b.extra_table_ids) as u(tid)), '{}')
  where b.night = p_night and b.status in ('booked', 'seated')
    and (p_mapping ? b.table_id::text or exists (select 1 from unnest(b.extra_table_ids) as u(tid) where p_mapping ? u.tid::text));

  if exists (
    select 1 from public.bookings b
    where b.night = p_night and b.status in ('booked', 'seated')
      and exists (
        select 1 from public.tables t
        where (t.id = b.table_id or t.id = any (b.extra_table_ids)) and t.layout_id <> p_layout
      )
  ) then
    raise exception 'unmapped_bookings';
  end if;
end $$;

-- ───────── Settings: shop name and LINE message templates ─────────
alter table public.settings
  add column shop_name text not null default 'Music Table' check (length(shop_name) <= 80),
  add column confirm_template text not null default
    E'สวัสดีค่ะคุณ{name}\nยืนยันการจองโต๊ะ {table} ที่ {shop}\nวัน{date} เวลา {time} น. จำนวน {guests} ท่าน\n{payment}\nหากต้องการเปลี่ยนแปลงแจ้งได้เลยนะคะ ขอบคุณค่ะ'
    check (length(confirm_template) <= 1000),
  add column reminder_template text not null default
    E'สวัสดีค่ะคุณ{name}\nแจ้งเตือนการจองโต๊ะ {table} ที่ {shop}\n{date} เวลา {time} น. จำนวน {guests} ท่าน\nรบกวนตอบกลับเพื่อยืนยันด้วยนะคะ ขอบคุณค่ะ'
    check (length(reminder_template) <= 1000);

-- ───────── App logs (client errors and warnings, kept 30 days) ─────────
create table public.app_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null check (length(event) between 1 and 80),
  message text not null default '' check (length(message) <= 2000),
  context jsonb not null default '{}' check (pg_column_size(context) <= 8000),
  user_id uuid default auth.uid(),
  app_version text check (length(app_version) <= 40),
  url text check (length(url) <= 300),
  user_agent text check (length(user_agent) <= 300)
);
create index app_logs_at_idx on public.app_logs (at desc);

create function public.app_logs_retention() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.app_logs where at < now() - interval '30 days';
  return null;
end $$;
create trigger app_logs_retention after insert on public.app_logs
  for each statement execute function public.app_logs_retention();

-- ───────── Row Level Security ─────────
alter table public.guests enable row level security;
alter table public.products enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_payments enable row level security;
alter table public.app_logs enable row level security;

create policy staff_read on public.guests for select to authenticated using (public.is_active_staff());
create policy staff_insert on public.guests for insert to authenticated with check (public.is_active_staff());
create policy staff_update on public.guests for update to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());

create policy staff_read on public.products for select to authenticated using (public.is_active_staff());
create policy manager_insert on public.products for insert to authenticated with check (public.is_manager());
create policy manager_update on public.products for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy staff_read on public.booking_items for select to authenticated using (public.is_active_staff());
create policy staff_insert on public.booking_items for insert to authenticated with check (public.is_active_staff());
create policy staff_delete on public.booking_items for delete to authenticated using (public.is_active_staff());

create policy staff_read on public.booking_payments for select to authenticated using (public.is_active_staff());
create policy staff_insert on public.booking_payments for insert to authenticated with check (public.is_active_staff());
create policy manager_delete on public.booking_payments for delete to authenticated using (public.is_manager());

create policy staff_insert on public.app_logs for insert to authenticated
  with check (public.is_active_staff() and user_id = auth.uid());
create policy manager_read on public.app_logs for select to authenticated using (public.is_manager());

grant select, insert, update on public.guests to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, delete on public.booking_items, public.booking_payments to authenticated;
grant select, insert on public.app_logs to authenticated;
grant select on public.guest_stats to authenticated;

revoke execute on function
  public.stamp_created_by(), public.payments_changed(), public.bookings_tables_changed(),
  public.bookings_link_guest(), public.app_logs_retention(), public.recompute_payment(uuid)
from public, anon, authenticated;
revoke execute on function public.booking_due(uuid) from public, anon;
grant execute on function public.booking_due(uuid), public.norm_phone(text) to authenticated;

alter publication supabase_realtime add table public.booking_payments, public.booking_items, public.guests;

-- ───────── Backfill ─────────
alter table public.bookings disable trigger bookings_before_write;
alter table public.bookings disable trigger bookings_log_history;
alter table public.bookings disable trigger bookings_payment_stamp;

insert into public.guests (phone, name)
select distinct on (public.norm_phone(phone)) public.norm_phone(phone), left(guest_name, 80)
from public.bookings
where length(regexp_replace(coalesce(public.norm_phone(phone), ''), '[^0-9]', '', 'g')) >= 6
order by public.norm_phone(phone), created_at
on conflict (phone) do nothing;

update public.bookings b set guest_id = g.id from public.guests g where g.phone = public.norm_phone(b.phone);

-- Existing "paid" bookings become one payment of the amount due (keeping slip, who and when).
insert into public.booking_payments (booking_id, amount, method, slip_path, created_by, created_at)
select b.id, greatest(public.booking_due(b.id), 1), 'transfer', b.slip_path, b.paid_by, coalesce(b.paid_at, now())
from public.bookings b where b.paid;

alter table public.bookings enable trigger bookings_before_write;
alter table public.bookings enable trigger bookings_log_history;
alter table public.bookings enable trigger bookings_payment_stamp;

insert into public.products (name, price, per_person) values
  ('SET WALK-IN (Monkey Shoulder 1 แก้ว)', 700, true),
  ('Monkey Shoulder ราคาพิเศษคอนเสิร์ต', 1990, false);
