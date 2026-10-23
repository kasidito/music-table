-- 011: whole-night booking mode, payment status chosen by staff, customer categories with discounts,
-- concert wristbands and set drinks per table.

-- ───────── Settings: how long a booking holds its table ─────────
-- night: one booking holds the table until closing (no duration to set).  timed: default duration, editable.
alter table public.settings
  add column booking_mode text not null default 'night' check (booking_mode in ('night', 'timed'));

-- ───────── Customer categories (e.g. เพื่อนหุ้นส่วน 10%, ส่วนลดวันเกิด) ─────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null default '#ACC1C6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  discount_pct int not null default 0 check (discount_pct between 0 and 100),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── Bookings: payment status, category, agreed price, wristband ─────────
alter table public.bookings
  add column pay_status text not null default 'unpaid'
    check (pay_status in ('unpaid', 'waiting', 'deposit', 'paid', 'at_venue')),
  add column category_id uuid references public.categories(id) on delete set null,
  add column sold_price int check (sold_price between 0 and 10000000),
  add column wristband_at timestamptz,
  add column wristband_by uuid references public.profiles(id) on delete set null;

-- Set drinks that come with a table (concert nights), shown in the concert report.
alter table public.tables add column set_note text check (length(set_note) <= 80);

-- ───────── Amount due: table price (agreed price, else less the category discount) + items ─────────
create or replace function public.booking_due(p_booking uuid) returns int
language sql stable security invoker set search_path = '' as $$
  select (
    coalesce(
      (select b.sold_price from public.bookings b where b.id = p_booking),
      (select (sum(t.price) * (100 - coalesce(max(c.discount_pct), 0)) / 100)
         from public.bookings b
         join public.tables t on t.id = b.table_id or t.id = any (b.extra_table_ids)
         left join public.categories c on c.id = b.category_id
        where b.id = p_booking),
      0)
    + coalesce((select sum(i.unit_price * i.qty) from public.booking_items i where i.booking_id = p_booking), 0)
  )::int
$$;

-- Payments keep amount_paid; recording money nudges the status forward but never back.
create or replace function public.recompute_payment(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  got int;
  due int;
  cur text;
  nxt text;
begin
  select coalesce(sum(amount), 0) into got from public.booking_payments where booking_id = p_booking;
  due := public.booking_due(p_booking);
  select pay_status into cur from public.bookings where id = p_booking;
  nxt := case
    when got > 0 and got >= due and cur in ('unpaid', 'waiting', 'deposit') then 'paid'
    when got > 0 and got < due and cur in ('unpaid', 'waiting') then 'deposit'
    else cur end;
  perform set_config('app.recompute', '1', true);
  update public.bookings set amount_paid = got, pay_status = nxt
  where id = p_booking and (amount_paid is distinct from got or pay_status is distinct from nxt);
  perform set_config('app.recompute', '', true);
end $$;

drop trigger bookings_tables_changed on public.bookings;
create trigger bookings_tables_changed after update of table_id, extra_table_ids, category_id, sold_price on public.bookings
  for each row execute function public.bookings_tables_changed();

-- ───────── Bookings validation: pay_status drives paid; wristband stamped by the server ─────────
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
    new.amount_paid := 0;
    new.wristband_at := case when new.wristband_at is not null then now() end;
    new.wristband_by := case when new.wristband_at is not null then auth.uid() end;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.is_walk_in := old.is_walk_in;
    if coalesce(current_setting('app.recompute', true), '') <> '1' then
      new.amount_paid := old.amount_paid;
    end if;
    if (new.wristband_at is null) <> (old.wristband_at is null) then
      new.wristband_at := case when new.wristband_at is not null then now() end;
      new.wristband_by := case when new.wristband_at is not null then auth.uid() end;
    else
      new.wristband_at := old.wristband_at;
      new.wristband_by := old.wristband_by;
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
  new.paid := new.pay_status = 'paid';

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

-- Layout copies keep the set drinks.
create or replace function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name, rooms) select p_name, rooms from public.layouts where id = p_layout returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y, kind, w, h, color, price, set_note)
  select new_id, floor, label, seats, shape, x, y, kind, w, h, color, price, set_note
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;

-- ───────── Security ─────────
alter table public.categories enable row level security;
create policy staff_read on public.categories for select to authenticated using (public.is_active_staff());
create policy manager_insert on public.categories for insert to authenticated with check (public.is_manager());
create policy manager_update on public.categories for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
grant select, insert, update on public.categories to authenticated;
alter publication supabase_realtime add table public.categories;

-- ───────── Backfill and seeds ─────────
alter table public.bookings disable trigger bookings_before_write;
alter table public.bookings disable trigger bookings_log_history;
update public.bookings set pay_status = case when paid then 'paid' when amount_paid > 0 then 'deposit' else 'unpaid' end;
alter table public.bookings enable trigger bookings_before_write;
alter table public.bookings enable trigger bookings_log_history;

insert into public.categories (name, color, discount_pct, sort) values
  ('เพื่อนหุ้นส่วน', '#F39646', 10, 1),
  ('ส่วนลดวันเกิด', '#E04314', 0, 2),
  ('VIP', '#C30C00', 0, 3),
  ('ขาประจำ', '#ACC1C6', 0, 4);

update public.tables t set set_note = case when t.seats >= 8 then 'Monkey 2 ขวด' else 'Monkey 1 ขวด' end
from public.layouts l
where l.id = t.layout_id and l.name = 'Purpeech' and t.kind = 'table';
