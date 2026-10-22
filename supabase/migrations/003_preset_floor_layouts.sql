-- Preset floor 1 and floor 2 of the default layout, traced from the bar's current floor plan.
-- x, y = centre; w, h = size (64 = one standard table). Seat counts are starting guesses, editable in the app.
insert into public.tables (layout_id, floor, kind, label, seats, shape, x, y, w, h)
select (select id from public.layouts where is_default), v.floor, v.kind, v.label, v.seats, v.shape, v.x, v.y, v.w, v.h
from (values
  -- Floor 1: left column
  (1, 'table', 'T14', 4, 'square', 183, 117, 64, 64),
  (1, 'table', 'T13', 4, 'square', 183, 182, 64, 64),
  (1, 'table', 'T12', 4, 'square', 183, 288, 64, 64),
  (1, 'table', 'T11', 4, 'square', 183, 353, 64, 64),
  (1, 'table', 'W2',  4, 'round',   67, 278, 64, 64),
  (1, 'table', 'W1',  4, 'round',   67, 362, 64, 64),
  -- Floor 1: sofas along the top
  (1, 'table', 'S1',  2, 'round',  371,  91, 64, 64),
  (1, 'table', 'S2',  2, 'round',  435,  91, 64, 64),
  (1, 'table', 'S3',  2, 'round',  499,  91, 64, 64),
  (1, 'table', 'T10', 4, 'square', 625, 104, 64, 64),
  (1, 'table', 'T9',  4, 'square', 625, 169, 64, 64),
  -- Floor 1: centre pairs
  (1, 'table', 'T7',  4, 'square', 402, 242, 64, 64),
  (1, 'table', 'T8',  4, 'square', 467, 242, 64, 64),
  (1, 'table', 'T5',  4, 'square', 402, 348, 64, 64),
  (1, 'table', 'T6',  4, 'square', 467, 348, 64, 64),
  (1, 'table', 'T3',  4, 'square', 402, 454, 64, 64),
  (1, 'table', 'T4',  4, 'square', 467, 454, 64, 64),
  (1, 'table', 'T1',  4, 'square', 402, 559, 64, 64),
  (1, 'table', 'T2',  4, 'square', 467, 559, 64, 64),
  -- Floor 1: bar stools
  (1, 'table', 'B5',  2, 'round',  592, 337, 50, 50),
  (1, 'table', 'B4',  2, 'round',  592, 397, 50, 50),
  (1, 'table', 'B3',  2, 'round',  592, 458, 50, 50),
  (1, 'table', 'B2',  2, 'round',  592, 518, 50, 50),
  (1, 'table', 'B1',  2, 'round',  592, 578, 50, 50),
  -- Floor 1: fixtures
  (1, 'stage', 'STAGE', 0, 'square', 153, 537, 297, 176),
  (1, 'bar',   'BAR',   0, 'square', 658, 457,  40, 330),
  (1, 'door',  'DOOR',  0, 'square',  10, 157,  20,  80),
  -- Floor 2
  (2, 'table', 'UP1',  4, 'square',  92, 189,  64,  64),
  (2, 'table', 'UP8',  6, 'square', 205, 106,  64, 128),
  (2, 'table', 'UP9',  6, 'square', 350, 106,  64, 128),
  (2, 'table', 'UP10', 4, 'square', 495,  74,  64,  64),
  (2, 'table', 'UP11', 4, 'square', 495, 139,  64,  64),
  (2, 'table', 'UP12', 4, 'square', 640,  74,  64,  64),
  (2, 'table', 'UP13', 4, 'square', 640, 139,  64,  64),
  (2, 'table', 'UP7',  4, 'square', 753, 189,  64,  64),
  (2, 'table', 'UP2',  6, 'square', 238, 304, 128,  64),
  (2, 'table', 'UP3',  4, 'square', 377, 304,  64,  64),
  (2, 'table', 'UP4',  4, 'square', 442, 304,  64,  64),
  (2, 'table', 'UP5',  4, 'square', 549, 304,  64,  64),
  (2, 'table', 'UP6',  4, 'square', 614, 304,  64,  64)
) as v(floor, kind, label, seats, shape, x, y, w, h);
