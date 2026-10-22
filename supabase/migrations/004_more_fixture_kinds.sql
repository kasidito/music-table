-- More non-bookable elements managers can place on a floor.
alter table public.tables drop constraint tables_kind_check;
alter table public.tables add constraint tables_kind_check
  check (kind in ('table', 'stage', 'bar', 'door', 'speaker', 'stairs', 'restroom', 'dj', 'wall'));
