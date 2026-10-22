-- Concert layouts traced from the event posters. Colors and prices follow each poster's PRICE legend;
-- seats = the poster's "maximum pax". x, y = centre; w, h = size.
do $$
declare
  purpeech uuid;
  greasy uuid;
  normal uuid := (select id from public.layouts where is_default);
begin
  insert into public.layouts (name) values ('Purpeech') returning id into purpeech;
  insert into public.layouts (name) values ('Greasy Cafe') returning id into greasy;

  -- ── Purpeech ──
  insert into public.tables (layout_id, floor, kind, label, seats, shape, x, y, w, h, color, price)
  select purpeech, v.floor, v.kind, v.label, v.seats, v.shape, v.x, v.y, v.w, v.h, v.color, v.price
  from (values
    -- Ground floor (stand)
    (1, 'bar',   'BAR',   0, 'square',  28, 141,  55, 282, null::text, null::int),
    (1, 'table', 'A18',   5, 'square',  84, 141,  59, 282, '#5DADE2', 5600),
    (1, 'stage', 'STAGE', 0, 'square', 518,  46, 381,  92, null, null),
    (1, 'table', 'A1',  5, 'round', 627, 150, 64, 64, '#D7261E', 6300),
    (1, 'table', 'A2',  5, 'round', 506, 146, 64, 64, '#D7261E', 6300),
    (1, 'table', 'A3',  5, 'round', 377, 146, 64, 64, '#D7261E', 6300),
    (1, 'table', 'A4',  5, 'round', 565, 238, 64, 64, '#1FA448', 5800),
    (1, 'table', 'A5',  5, 'round', 439, 237, 64, 64, '#1FA448', 5800),
    (1, 'table', 'A6',  5, 'round', 305, 213, 64, 64, '#1FA448', 5800),
    (1, 'table', 'A7',  5, 'round', 265, 103, 64, 64, '#1FA448', 5800),
    (1, 'table', 'A8',  5, 'round', 570, 327, 64, 64, '#5DADE2', 5600),
    (1, 'table', 'A9',  5, 'round', 465, 327, 64, 64, '#5DADE2', 5600),
    (1, 'table', 'A10', 5, 'round', 342, 309, 64, 64, '#5DADE2', 5600),
    (1, 'table', 'A11', 5, 'round', 218, 279, 64, 64, '#5DADE2', 5600),
    (1, 'table', 'A12', 5, 'round', 187, 167, 64, 64, '#5DADE2', 5600),
    (1, 'table', 'A13', 5, 'round', 146, 356, 64, 64, '#F5B800', 5400),
    (1, 'table', 'A14', 5, 'round',  56, 331, 64, 64, '#F5B800', 5400),
    (1, 'table', 'A15', 5, 'round', 240, 409, 64, 64, '#F5B800', 5400),
    (1, 'table', 'A16', 5, 'round', 329, 409, 64, 64, '#F5B800', 5400),
    (1, 'table', 'A17', 5, 'round', 420, 410, 64, 64, '#F5B800', 5400),
    (1, 'restroom', 'WC', 0, 'square', 139, 455, 66, 66, null, null),
    (1, 'stairs', 'STAIRS', 0, 'square', 662, 460, 66, 66, null, null),
    (1, 'door', 'DOOR', 0, 'square', 704, 339, 14, 88, null, null),
    -- Top floor (sit)
    (2, 'sofa', 'SOFA', 0, 'square', 35, 118, 60, 181, null, null),
    (2, 'sofa', 'SOFA', 0, 'square', 35, 302, 60, 179, null, null),
    (2, 'sofa', 'SOFA', 0, 'square', 35, 488, 60, 179, null, null),
    (2, 'table', 'C5', 6, 'square', 123, 103, 62, 99, '#3A3A3F', 4200),
    (2, 'table', 'C6', 6, 'square', 123, 226, 62, 99, '#3A3A3F', 4200),
    (2, 'table', 'C7', 6, 'square', 123, 389, 62, 99, '#3A3A3F', 4200),
    (2, 'zone', 'SHARED', 0, 'square', 123, 513, 62, 99, null, null),
    (2, 'table', 'B4', 8, 'square', 306, 100, 123, 63, '#4B35A8', 7600),
    (2, 'table', 'B3', 8, 'square', 306, 187, 123, 63, '#4B35A8', 7600),
    (2, 'table', 'B2', 8, 'square', 306, 360, 123, 63, '#4B35A8', 7600),
    (2, 'table', 'B1', 8, 'square', 306, 446, 123, 63, '#4B35A8', 7600),
    (2, 'stairs', 'STAIRS', 0, 'square', 370, 553, 66, 66, null, null)
  ) as v(floor, kind, label, seats, shape, x, y, w, h, color, price);

  -- ── Greasy Cafe ──
  -- Ground floor: the normal floor-1 plan, recoloured by the poster, with 6 bar seats.
  insert into public.tables (layout_id, floor, kind, label, seats, shape, x, y, w, h, color, price)
  select greasy, 1, t.kind, t.label, case when t.kind = 'table' then 4 else 0 end, t.shape, t.x, t.y, t.w, t.h,
    case when t.label in ('W1','W2','T11','T12','T1','T3') then '#1FA448'
         when t.label in ('T14','T13','T7','T8','T5','T6','T4','T2') then '#D7261E'
         when t.label in ('S1','S2','S3','T9','T10') then '#5DADE2' end,
    case when t.label in ('W1','W2','T11','T12','T1','T3') then 3500
         when t.label in ('T14','T13','T7','T8','T5','T6','T4','T2') then 3300
         when t.label in ('S1','S2','S3','T9','T10') then 3000 end
  from public.tables t
  where t.layout_id = normal and t.floor = 1 and not t.archived and t.label !~ '^B[0-9]$';

  insert into public.tables (layout_id, floor, kind, label, seats, shape, x, y, w, h, color, price)
  select greasy, v.floor, v.kind, v.label, v.seats, v.shape, v.x, v.y, v.w, v.h, v.color, v.price
  from (values
    (1, 'table', 'B6', 1, 'round', 592, 333, 46, 46, '#F5B800', 500),
    (1, 'table', 'B5', 1, 'round', 592, 384, 46, 46, '#F5B800', 500),
    (1, 'table', 'B4', 1, 'round', 592, 435, 46, 46, '#F5B800', 500),
    (1, 'table', 'B3', 1, 'round', 592, 486, 46, 46, '#F5B800', 500),
    (1, 'table', 'B2', 1, 'round', 592, 537, 46, 46, '#F5B800', 500),
    (1, 'table', 'B1', 1, 'round', 592, 588, 46, 46, '#F5B800', 500),
    (1, 'restroom', 'WC', 0, 'square', 690, 60, 50, 50, null, null),
    (1, 'stairs', 'STAIRS', 0, 'square', 50, 60, 50, 50, null, null),
    -- Top floor
    (2, 'sofa', 'SOFA', 0, 'square', 35, 126, 62, 187, null, null),
    (2, 'sofa', 'SOFA', 0, 'square', 35, 317, 62, 190, null, null),
    (2, 'sofa', 'SOFA', 0, 'square', 35, 507, 62, 178, null, null),
    (2, 'table', 'A5', 6, 'square', 131, 108, 66, 103, '#3A3A3F', 2400),
    (2, 'table', 'A6', 6, 'square', 131, 240, 66, 103, '#3A3A3F', 2400),
    (2, 'table', 'A7', 6, 'square', 131, 407, 66, 103, '#3A3A3F', 2400),
    (2, 'table', 'A8', 6, 'square', 131, 539, 66, 103, '#3A3A3F', 2400),
    (2, 'table', 'B4', 8, 'square', 325,  80, 129, 66, '#4B35A8', 5400),
    (2, 'table', 'B3', 8, 'square', 325, 209, 129, 66, '#4B35A8', 5400),
    (2, 'table', 'B2', 8, 'square', 325, 338, 129, 66, '#4B35A8', 5400),
    (2, 'table', 'B1', 8, 'square', 325, 466, 129, 66, '#4B35A8', 5400),
    (2, 'stairs', 'STAIRS', 0, 'square', 400, 593, 66, 66, null, null)
  ) as v(floor, kind, label, seats, shape, x, y, w, h, color, price);
end $$;
