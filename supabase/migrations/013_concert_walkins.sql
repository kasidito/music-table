-- 013: concert walk-ins. A walk-in may stand (no table); each concert layout has its own walk-in price per person.

alter table public.layouts add column walkin_price int check (walkin_price between 0 and 1000000);
alter table public.bookings alter column table_id drop not null;
alter table public.bookings add constraint bookings_table_or_walkin check (table_id is not null or is_walk_in);

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
      -- Managers may also correct mistakes (e.g. a wrong no-show back to booked); every change stays in history.
      if not (new.status = any (allowed)) and not public.is_manager() then
        raise exception 'invalid_status_change';
      end if;
    end if;
  end if;
  new.paid := new.pay_status = 'paid';

  new.updated_by := auth.uid();
  new.updated_at := now();

  -- Standing walk-ins (concert nights) have no table.
  if new.table_id is null then
    if not new.is_walk_in then raise exception 'table_required'; end if;
    if cardinality(new.extra_table_ids) > 0 then raise exception 'invalid_extra_tables'; end if;
  elsif tg_op = 'INSERT' or new.table_id is distinct from old.table_id or new.night is distinct from old.night then
    select layout_id, archived, kind into t from public.tables where id = new.table_id;
    if t.kind <> 'table' then raise exception 'not_a_table'; end if;
    if t.archived then raise exception 'table_archived'; end if;
    if t.layout_id is distinct from public.layout_for(new.night) then
      raise exception 'table_not_in_night_layout';
    end if;
  end if;

  if new.table_id is not null and (tg_op = 'INSERT' or new.extra_table_ids is distinct from old.extra_table_ids or new.night is distinct from old.night) then
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

-- Copies of a concert layout keep its walk-in price.
create or replace function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name, rooms, walkin_price) select p_name, rooms, walkin_price from public.layouts where id = p_layout returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y, kind, w, h, color, price, set_note)
  select new_id, floor, label, seats, shape, x, y, kind, w, h, color, price, set_note
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;

update public.layouts set walkin_price = 700 where name in ('Purpeech', 'Greasy Cafe') and walkin_price is null;
