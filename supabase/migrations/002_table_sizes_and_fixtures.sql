-- Tables get an explicit size, and layouts can hold non-bookable fixtures (stage, bar, door).
alter table public.tables
  add column kind text not null default 'table' check (kind in ('table', 'stage', 'bar', 'door')),
  add column w numeric check (w is null or w between 10 and 1000),
  add column h numeric check (h is null or h between 10 and 1000);

alter table public.tables drop constraint tables_seats_check;
alter table public.tables add constraint tables_seats_check
  check ((kind = 'table' and seats between 1 and 50) or (kind <> 'table' and seats between 0 and 50));

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
    select layout_id, archived, kind into t from public.tables where id = new.table_id;
    if t.kind <> 'table' then raise exception 'not_a_table'; end if;
    if t.archived then raise exception 'table_archived'; end if;
    if t.layout_id is distinct from public.layout_for(new.night) then
      raise exception 'table_not_in_night_layout';
    end if;
  end if;
  return new;
end $$;

create or replace function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name) values (p_name) returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y, kind, w, h)
  select new_id, floor, label, seats, shape, x, y, kind, w, h
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;
