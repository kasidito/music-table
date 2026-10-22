-- Price tiers on tables (concert posters) and payment tracking on bookings.
alter table public.tables
  add column color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  add column price int check (price is null or price between 0 and 1000000);

alter table public.tables drop constraint tables_kind_check;
alter table public.tables add constraint tables_kind_check
  check (kind in ('table', 'stage', 'bar', 'door', 'speaker', 'stairs', 'restroom', 'dj', 'wall', 'sofa', 'zone'));

alter table public.bookings
  add column paid boolean not null default false,
  add column paid_at timestamptz,
  add column paid_by uuid references public.profiles(id) on delete set null,
  add column slip_path text check (slip_path is null or slip_path ~ '^[0-9a-f-]{36}/[0-9A-Za-z._-]+$');

-- Stamp who marked a booking paid, and when.
create function public.bookings_payment_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.paid is distinct from old.paid then
    if new.paid then
      new.paid_at := now(); new.paid_by := auth.uid();
    else
      new.paid_at := null; new.paid_by := null;
    end if;
  else
    new.paid_at := old.paid_at; new.paid_by := old.paid_by;
  end if;
  return new;
end $$;

create trigger bookings_payment_stamp before insert or update on public.bookings
for each row execute function public.bookings_payment_stamp();

revoke execute on function public.bookings_payment_stamp() from public, anon, authenticated;

create or replace function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name) values (p_name) returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y, kind, w, h, color, price)
  select new_id, floor, label, seats, shape, x, y, kind, w, h, color, price
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;
