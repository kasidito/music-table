-- 012: managers can undo a guest-status mistake; Greasy Cafe set drinks (same rule as Purpeech).

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

update public.tables t set set_note = case when t.seats >= 8 then 'Monkey 2 ขวด' else 'Monkey 1 ขวด' end
from public.layouts l
where l.id = t.layout_id and l.name = 'Greasy Cafe' and t.kind = 'table' and t.set_note is null;
