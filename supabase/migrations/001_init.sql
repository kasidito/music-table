-- Music-Table: staff-only table booking for a bar
-- All times are Asia/Bangkok.

-- ───────── Tables ─────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('manager', 'staff')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  open_time time not null default '18:00',
  close_time time not null default '02:00',
  default_duration_min int not null default 120 check (default_duration_min between 15 and 720)
);
insert into public.settings default values;

create table public.layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index layouts_one_default on public.layouts (is_default) where is_default;

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.layouts(id) on delete cascade,
  floor smallint not null check (floor in (1, 2)),
  label text not null check (length(trim(label)) > 0),
  seats int not null check (seats between 1 and 50),
  shape text not null default 'square' check (shape in ('round', 'square')),
  x numeric not null default 100,
  y numeric not null default 100,
  archived boolean not null default false
);
create index tables_layout_idx on public.tables (layout_id);

create table public.day_layouts (
  night date primary key,
  layout_id uuid not null references public.layouts(id) on delete cascade
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete restrict,
  night date not null,
  start_at timestamptz not null,
  duration_min int not null check (duration_min between 15 and 720),
  party_size int not null check (party_size between 1 and 200),
  guest_name text not null default '',
  phone text not null default '',
  note text not null default '',
  status text not null default 'booked'
    check (status in ('booked', 'seated', 'done', 'cancelled', 'no_show')),
  is_walk_in boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_name_required check (is_walk_in or length(trim(guest_name)) > 0),
  constraint phone_required check (is_walk_in or length(trim(phone)) > 0)
);
create index bookings_night_idx on public.bookings (night);
create index bookings_table_night_idx on public.bookings (table_id, night);

create table public.booking_history (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  action text not null check (action in ('insert', 'update')),
  old_row jsonb,
  new_row jsonb not null
);
create index booking_history_booking_idx on public.booking_history (booking_id);

-- ───────── Helpers ─────────

create function public.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'manager');
$$;

-- A night runs from opening to closing; times after midnight but before closing belong to the previous night.
create function public.night_of(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select case
    when s.close_time < s.open_time and (ts at time zone 'Asia/Bangkok')::time < s.close_time
      then (ts at time zone 'Asia/Bangkok')::date - 1
    else (ts at time zone 'Asia/Bangkok')::date
  end
  from public.settings s where s.id = 1;
$$;

create function public.layout_for(n date) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select layout_id from public.day_layouts where night = n),
    (select id from public.layouts where is_default)
  );
$$;

-- ───────── Triggers ─────────

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first_user boolean := not exists (select 1 from public.profiles);
begin
  -- First account becomes the manager. Anyone else starts inactive until a manager creates/enables them.
  insert into public.profiles (id, email, display_name, role, active)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)),
    case when first_user then 'manager' else 'staff' end,
    first_user
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.profiles_keep_a_manager() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where role = 'manager' and active) then
    raise exception 'need_one_manager';
  end if;
  return null;
end $$;

create trigger profiles_keep_a_manager after update on public.profiles
for each statement execute function public.profiles_keep_a_manager();

create function public.layouts_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.is_default := not exists (select 1 from public.layouts where is_default);
  return new;
end $$;

create trigger layouts_before_insert before insert on public.layouts
for each row execute function public.layouts_before_insert();

create function public.layouts_before_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_default then raise exception 'cannot_delete_default_layout'; end if;
  return old;
end $$;

create trigger layouts_before_delete before delete on public.layouts
for each row execute function public.layouts_before_delete();

create function public.tables_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.layout_id <> old.layout_id then raise exception 'cannot_move_table_between_layouts'; end if;
  if new.archived and not old.archived and exists (
    select 1 from public.bookings b
    where b.table_id = old.id and b.status in ('booked', 'seated')
      and b.start_at + make_interval(mins => b.duration_min) > now()
  ) then
    raise exception 'table_has_future_bookings';
  end if;
  return new;
end $$;

create trigger tables_before_update before update on public.tables
for each row execute function public.tables_before_update();

create function public.bookings_before_write() returns trigger
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
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.is_walk_in := old.is_walk_in;
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
    select layout_id, archived into t from public.tables where id = new.table_id;
    if t.archived then raise exception 'table_archived'; end if;
    if t.layout_id is distinct from public.layout_for(new.night) then
      raise exception 'table_not_in_night_layout';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_before_write before insert or update on public.bookings
for each row execute function public.bookings_before_write();

create function public.bookings_log_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_history (booking_id, changed_by, action, old_row, new_row)
  values (
    new.id, auth.uid(), lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end $$;

create trigger bookings_log_history after insert or update on public.bookings
for each row execute function public.bookings_log_history();

-- ───────── Manager RPCs ─────────

-- Choose a night's layout. p_mapping = {"<old table id>": "<new table id>", ...} for bookings that must move.
create function public.set_night_layout(p_night date, p_layout uuid, p_mapping jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;

  insert into public.day_layouts (night, layout_id) values (p_night, p_layout)
  on conflict (night) do update set layout_id = excluded.layout_id;

  update public.bookings b
  set table_id = (p_mapping->>b.table_id::text)::uuid
  where b.night = p_night and b.status in ('booked', 'seated')
    and p_mapping ? b.table_id::text;

  if exists (
    select 1 from public.bookings b join public.tables t on t.id = b.table_id
    where b.night = p_night and b.status in ('booked', 'seated') and t.layout_id <> p_layout
  ) then
    raise exception 'unmapped_bookings';
  end if;
end $$;

-- Make a layout the default, pinning nights that already have bookings to the old default.
create function public.set_default_layout(p_layout uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare old_default uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  select id into old_default from public.layouts where is_default;
  if old_default = p_layout then return; end if;

  if old_default is not null then
    insert into public.day_layouts (night, layout_id)
    select distinct b.night, old_default
    from public.bookings b join public.tables t on t.id = b.table_id
    where t.layout_id = old_default
    on conflict (night) do nothing;

    update public.layouts set is_default = false where id = old_default;
  end if;
  update public.layouts set is_default = true where id = p_layout;
end $$;

create function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name) values (p_name) returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y)
  select new_id, floor, label, seats, shape, x, y
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;

-- ───────── Row Level Security ─────────

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.layouts enable row level security;
alter table public.tables enable row level security;
alter table public.day_layouts enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_history enable row level security;

create policy staff_read on public.profiles for select to authenticated
  using (public.is_active_staff() or id = auth.uid());
create policy manager_update on public.profiles for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy staff_read on public.settings for select to authenticated using (public.is_active_staff());
create policy manager_update on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy staff_read on public.layouts for select to authenticated using (public.is_active_staff());
create policy manager_insert on public.layouts for insert to authenticated with check (public.is_manager());
create policy manager_update on public.layouts for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy manager_delete on public.layouts for delete to authenticated using (public.is_manager());

create policy staff_read on public.tables for select to authenticated using (public.is_active_staff());
create policy manager_insert on public.tables for insert to authenticated with check (public.is_manager());
create policy manager_update on public.tables for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy staff_read on public.day_layouts for select to authenticated using (public.is_active_staff());

create policy staff_read on public.bookings for select to authenticated using (public.is_active_staff());
create policy staff_insert on public.bookings for insert to authenticated with check (public.is_active_staff());
create policy staff_update on public.bookings for update to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());

create policy staff_read on public.booking_history for select to authenticated using (public.is_active_staff());

-- ───────── Grants ─────────

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles, public.settings to authenticated;
grant select, insert, update, delete on public.layouts to authenticated;
grant select, insert, update on public.tables, public.bookings to authenticated;
grant select on public.day_layouts, public.booking_history to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_active_staff(), public.is_manager(), public.night_of(timestamptz), public.layout_for(date),
  public.set_night_layout(date, uuid, jsonb), public.set_default_layout(uuid), public.duplicate_layout(uuid, text)
to authenticated;

-- ───────── Realtime ─────────

alter publication supabase_realtime add table
  public.bookings, public.tables, public.layouts, public.day_layouts, public.settings;

-- ───────── Seed ─────────

insert into public.layouts (name) values ('Normal');

-- Trigger functions are never called directly.
revoke execute on function
  public.handle_new_user(), public.bookings_log_history(), public.bookings_before_write(),
  public.tables_before_update(), public.layouts_before_insert(), public.layouts_before_delete(),
  public.profiles_keep_a_manager()
from authenticated;
