-- Each layout stores its room size per floor, e.g. {"1": {"w": 730, "h": 629}, "2": {...}}.
-- Items are placed inside 0..w, 0..h; the walls are the room edges.
alter table public.layouts add column rooms jsonb not null default '{}'::jsonb;

-- Start every existing layout with a room that fits what is already on each floor.
update public.layouts l set rooms = coalesce((
  select jsonb_object_agg(f.floor::text, jsonb_build_object('w', ceil(f.mx + 24), 'h', ceil(f.my + 24)))
  from (
    select t.floor, max(t.x + coalesce(t.w, 64) / 2) as mx, max(t.y + coalesce(t.h, 64) / 2) as my
    from public.tables t where t.layout_id = l.id and not t.archived group by t.floor
  ) f), '{}'::jsonb);

-- The traced presets use the exact wall sizes from the floor plans.
update public.layouts set rooms = '{"1": {"w": 730, "h": 629}, "2": {"w": 846, "h": 378}}' where name = 'Normal';
update public.layouts set rooms = '{"1": {"w": 709, "h": 504}, "2": {"w": 418, "h": 602}}' where name = 'Purpeech';
update public.layouts set rooms = '{"1": {"w": 730, "h": 629}, "2": {"w": 442, "h": 638}}' where name = 'Greasy Cafe';

create or replace function public.duplicate_layout(p_layout uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  insert into public.layouts (name, rooms) select p_name, rooms from public.layouts where id = p_layout returning id into new_id;
  insert into public.tables (layout_id, floor, label, seats, shape, x, y, kind, w, h, color, price)
  select new_id, floor, label, seats, shape, x, y, kind, w, h, color, price
  from public.tables where layout_id = p_layout and not archived;
  return new_id;
end $$;
