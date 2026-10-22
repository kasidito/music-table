\set ON_ERROR_STOP on
-- Test helpers (owned by superuser, callable by authenticated)
create function public.t_login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); $$;
create function public.t_expect_error(q text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || msg || '%' then raise exception 'expected "%" got "%"', msg, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error "%" but query succeeded: %', msg, q;
end $$;
create function public.t_assert(cond boolean, label text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERT FAILED: %', label; end if; end $$;
grant execute on function public.t_login(uuid), public.t_expect_error(text, text), public.t_assert(boolean, text) to authenticated, anon;

-- Users: first = manager, second/third start inactive
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'boss@bar.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'staff@bar.test');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'rando@x.test', '{"role":"manager"}');
select t_assert((select role = 'manager' and active from profiles where email = 'boss@bar.test'), 'first user is active manager');
select t_assert((select role = 'staff' and not active from profiles where email = 'rando@x.test'), 'self-signup cannot become manager, starts inactive');
-- what the create-staff function does with the service role:
update profiles set active = true where email = 'staff@bar.test';

set role authenticated;

-- ── Inactive signup sees nothing ──
select t_login('00000000-0000-0000-0000-00000000000c');
select t_assert((select count(*) from layouts) = 0, 'inactive user cannot read layouts');
select t_expect_error($$insert into layouts(name) values ('x')$$, 'row-level security');

-- ── Manager builds layouts ──
select t_login('00000000-0000-0000-0000-00000000000a');
select t_assert((select is_default from layouts where name = 'Normal'), 'seed layout is default');
insert into tables (layout_id, floor, label, seats, shape, x, y)
select id, f, 'T' || f || n, 4, 'square', n * 100, 100 from layouts, generate_series(1,2) f, generate_series(1,3) n where name = 'Normal';
select duplicate_layout((select id from layouts where name = 'Normal'), 'Concert');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Concert') = 6, 'duplicate copies tables');
select t_assert(not (select is_default from layouts where name = 'Concert'), 'duplicate is not default');
select t_expect_error($$delete from layouts where name = 'Normal'$$, 'cannot_delete_default_layout');

-- ── Staff cannot touch layouts / profiles / settings ──
select t_login('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from layouts) = 2, 'staff can read layouts');
select t_expect_error($$insert into layouts(name) values ('x')$$, 'row-level security');
update tables set seats = 99;
select t_assert((select max(seats) from tables) = 4, 'staff update on tables silently blocked by RLS');
update settings set default_duration_min = 30;
select t_assert((select default_duration_min from settings) = 120, 'staff cannot change settings');
update profiles set role = 'manager' where email = 'staff@bar.test';
select t_assert((select role from profiles where email = 'staff@bar.test') = 'staff', 'staff cannot promote self');
select t_expect_error($$select set_night_layout('2030-01-10', (select id from layouts where name='Concert'))$$, 'forbidden');
select t_expect_error($$delete from bookings$$, 'permission denied');

-- ── Bookings ──
-- 20:00 on 2030-01-10 and 01:00 on 2030-01-11 both belong to night 2030-01-10
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
select id, '2030-01-10 20:00+07', 120, 4, 'Somchai', '0812345678' from tables t
 where label = 'T11' and layout_id = (select id from layouts where name = 'Normal');
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
select id, '2030-01-11 01:00+07', 60, 2, 'Late', '0899999999' from tables t
 where label = 'T12' and layout_id = (select id from layouts where name = 'Normal');
select t_assert((select count(*) from bookings where night = '2030-01-10') = 2, 'after-midnight booking counts for previous night');
select t_assert((select created_by from bookings where guest_name = 'Somchai') = '00000000-0000-0000-0000-00000000000b', 'created_by set to caller');

-- validation
select t_expect_error($$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
  select id, '2030-01-10 21:00+07', 120, 2, '', '' from tables where label='T13' limit 1$$, 'guest_name_required');
select t_expect_error($$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone, status)
  select id, '2030-01-10 21:00+07', 120, 2, 'a', '1', 'done' from tables where label='T13' limit 1$$, 'invalid_initial_status');
select t_expect_error($$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
  select t.id, '2030-01-10 21:00+07', 120, 2, 'a', '1' from tables t join layouts l on l.id=t.layout_id where l.name='Concert' limit 1$$, 'table_not_in_night_layout');

-- walk-in: no name/phone needed, starts seated
insert into bookings (table_id, start_at, duration_min, party_size, is_walk_in, status)
select id, '2030-01-10 19:00+07', 120, 3, true, 'seated' from tables
 where label = 'T13' and layout_id = (select id from layouts where name = 'Normal');

-- status transitions
update bookings set status = 'seated' where guest_name = 'Somchai';
update bookings set status = 'done' where guest_name = 'Somchai';
select t_expect_error($$update bookings set status = 'booked' where guest_name = 'Somchai'$$, 'invalid_status_change');
update bookings set status = 'no_show' where guest_name = 'Late';
select t_expect_error($$update bookings set status = 'seated' where guest_name = 'Late'$$, 'invalid_status_change');

-- history: who / before / after
select t_assert((select count(*) from booking_history h join bookings b on b.id = h.booking_id where b.guest_name = 'Somchai') = 3, 'insert + 2 updates logged');
select t_assert((select bool_and(changed_by = '00000000-0000-0000-0000-00000000000b') from booking_history), 'history records staff');
select t_assert((select old_row->>'status' = 'seated' and new_row->>'status' = 'done' from booking_history h join bookings b on b.id = h.booking_id
  where b.guest_name = 'Somchai' order by h.id desc limit 1), 'history has before/after');
select t_expect_error($$insert into booking_history (booking_id, action, new_row) select id, 'insert', '{}' from bookings limit 1$$, 'permission denied');
select t_expect_error($$delete from booking_history$$, 'permission denied');

-- ── Archive guard ──
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
select id, '2030-01-10 22:00+07', 120, 6, 'Future', '0811111111' from tables
 where label = 'T21' and layout_id = (select id from layouts where name = 'Normal');
select t_login('00000000-0000-0000-0000-00000000000a');
select t_expect_error($$update tables set archived = true where label = 'T21' and layout_id = (select id from layouts where name='Normal')$$, 'table_has_future_bookings');
update tables set archived = true where label = 'T23' and layout_id = (select id from layouts where name = 'Normal');
select t_assert((select archived from tables where label = 'T23' and layout_id = (select id from layouts where name = 'Normal')), 'free table can be archived');
select t_expect_error($$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
  select id, '2030-01-10 21:00+07', 60, 2, 'a', '1' from tables where label='T23' and layout_id = (select id from layouts where name='Normal')$$, 'table_archived');

-- ── Switch night layout: must map active bookings ──
select t_expect_error($$select set_night_layout('2030-01-10', (select id from layouts where name='Concert'))$$, 'unmapped_bookings');
select t_assert((select count(*) from day_layouts) = 0, 'failed switch rolled back');
-- active bookings on that night: walk-in on T13 (seated), Future on T21 (booked)
select set_night_layout('2030-01-10', (select id from layouts where name = 'Concert'), (
  select jsonb_object_agg(o.id, n.id) from tables o
  join tables n on n.label = o.label and n.layout_id = (select id from layouts where name = 'Concert')
  where o.layout_id = (select id from layouts where name = 'Normal') and o.label in ('T13', 'T21')));
select t_assert((select bool_and(t.layout_id = (select id from layouts where name = 'Concert'))
  from bookings b join tables t on t.id = b.table_id where b.status in ('booked','seated')), 'active bookings moved to Concert tables');
select t_assert((select count(*) from booking_history where old_row->>'table_id' <> new_row->>'table_id') = 2, 'moves logged in history');

-- ── Change default: nights with bookings stay pinned ──
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
select id, '2030-01-12 20:00+07', 120, 2, 'Sat', '0822222222' from tables
 where label = 'T11' and layout_id = (select id from layouts where name = 'Normal');
select set_default_layout((select id from layouts where name = 'Concert'));
select t_assert((select is_default from layouts where name = 'Concert'), 'Concert is default');
select t_assert(layout_for('2030-01-12') = (select id from layouts where name = 'Normal'), 'night with Normal bookings pinned to Normal');
select t_assert(layout_for('2030-02-01') = (select id from layouts where name = 'Concert'), 'empty night uses new default');

-- ── Keep at least one manager ──
select t_expect_error($$update profiles set role = 'staff' where email = 'boss@bar.test'$$, 'need_one_manager');
update profiles set active = false where email = 'staff@bar.test';
select t_login('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from bookings) = 0, 'deactivated staff loses access');

-- ── Anon gets nothing ──
reset role;
set role anon;
select t_expect_error($$select * from bookings$$, 'permission denied');
reset role;


select 'ALL TESTS PASSED' as result;
