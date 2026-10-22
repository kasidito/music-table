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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'boss@bar.test');

-- ── Preset layout + fixtures ──
select t_assert((select count(*) from tables where kind = 'table' and layout_id = (select id from layouts where name='Normal') and label ~ '^(T1[0-4]|T[1-9]|S[1-3]|B[1-5]|W[12]|UP[0-9]+)$') = 37, 'preset has 37 bookable tables');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Normal' and kind <> 'table') = 3, 'stage, bar and door fixtures');
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a');
select t_expect_error($q$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
  select id, '2030-02-01 21:00+07', 60, 2, 'a', '1' from tables where kind='stage' limit 1$q$, 'not_a_table');
select t_expect_error($q$insert into tables (layout_id, floor, label, seats) select id, 1, 'X', 0 from layouts where name='Normal'$q$, 'tables_seats_check');
select duplicate_layout((select id from layouts where name='Normal'), 'Copy');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Copy' and t.kind = 'stage' and t.w = 297) = 1, 'duplicate copies fixtures and sizes');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Copy') = 40, 'duplicate copies all 40 items');
reset role;

-- ── Concert layouts, tiers, payment ──
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and t.kind = 'table' and t.floor = 1) = 18, 'Purpeech ground 18 tables');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and t.kind = 'table' and t.floor = 2) = 7, 'Purpeech top 7 tables');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Greasy Cafe' and t.kind = 'table' and t.floor = 1) = 25, 'Greasy ground 25 tables');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Greasy Cafe' and t.kind = 'table' and t.floor = 2) = 8, 'Greasy top 8 tables');
select t_assert((select bool_and(price is not null and color is not null) from tables t join layouts l on l.id = t.layout_id where l.name in ('Purpeech','Greasy Cafe') and t.kind = 'table'), 'every concert table has a tier');
select t_assert((select price from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and label = 'A1') = 6300, 'A1 is 6,300');
select t_assert((select bool_and(price is null) from tables t join layouts l on l.id = t.layout_id where l.name = 'Normal'), 'normal layout has no prices');
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a');
select set_night_layout('2030-03-01', (select id from layouts where name = 'Purpeech'));
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
select t.id, '2030-03-01 20:00+07', 180, 5, 'Fan', '0811111111' from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and t.label = 'A1';
select t_assert((select not paid and paid_at is null from bookings where guest_name = 'Fan'), 'new booking unpaid');
-- Payments are recorded as rows; paid/amount_paid are derived and can't be set directly.
update bookings set paid = true, amount_paid = 999999 where guest_name = 'Fan';
select t_assert((select not paid and amount_paid = 0 from bookings where guest_name = 'Fan'), 'paid fields not directly writable');
select t_assert(booking_due((select id from bookings where guest_name = 'Fan')) = 6300, 'due = table price');
insert into booking_payments (booking_id, amount, slip_path, created_by)
select id, 2000, id::text || '/slip-1.jpg', '00000000-0000-0000-0000-00000000000b' from bookings where guest_name = 'Fan';
select t_assert((select not paid and amount_paid = 2000 from bookings where guest_name = 'Fan'), 'deposit = partial');
select t_assert((select created_by = '00000000-0000-0000-0000-00000000000a' from booking_payments limit 1), 'created_by cannot be spoofed');
insert into booking_items (booking_id, name, unit_price, qty) select id, 'Monkey Shoulder', 1990, 1 from bookings where guest_name = 'Fan';
select t_assert(booking_due((select id from bookings where guest_name = 'Fan')) = 8290, 'due includes items');
insert into booking_payments (booking_id, amount, method) select id, 6290, 'cash' from bookings where guest_name = 'Fan';
select t_assert((select paid and amount_paid = 8290 and paid_at is not null and paid_by = '00000000-0000-0000-0000-00000000000a' from bookings where guest_name = 'Fan'), 'fully paid, stamped');
update bookings set note = 'VIP' where guest_name = 'Fan';
select t_assert((select paid and paid_at is not null from bookings where guest_name = 'Fan'), 'other edits keep paid');
select t_expect_error($q$insert into booking_payments (booking_id, amount, slip_path) select id, 1, '../x' from bookings where guest_name = 'Fan'$q$, 'slip_path_check');
delete from booking_payments where method = 'cash';
select t_assert((select not paid and amount_paid = 2000 and paid_at is null from bookings where guest_name = 'Fan'), 'manager delete payment -> partial again');
select t_assert((select count(*) from booking_history h join bookings b on b.id = h.booking_id where b.guest_name = 'Fan' and h.old_row->>'paid' <> h.new_row->>'paid') = 2, 'paid changes in history');
reset role;

-- ── Rooms ──
select t_assert((select rooms->'1'->>'w' from layouts where name = 'Purpeech') = '709', 'Purpeech room size');
select t_assert((select (rooms->'1'->>'w')::int > 0 from layouts where name = 'Copy'), 'duplicate keeps rooms');

-- ── 009: guests, extra tables, products, logs ──
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'staff@bar.test');
update profiles set active = true where email = 'staff@bar.test';
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000b');
-- guest linked by normalised phone; second booking reuses the guest
select t_assert((select g.phone = '0811111111' and g.name = 'Fan' from bookings b join guests g on g.id = b.guest_id where b.guest_name = 'Fan'), 'guest created from booking');
insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone, extra_table_ids)
select (select t.id from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and t.label = 'A2'),
       '2030-03-01 21:00+07', 120, 8, 'Fan again', '081-111-1111',
       array[(select t.id from tables t join layouts l on l.id = t.layout_id where l.name = 'Purpeech' and t.label = 'A3')];
select t_assert((select count(distinct guest_id) from bookings where guest_name like 'Fan%') = 1, 'same guest for same phone');
select t_assert(booking_due((select id from bookings where guest_name = 'Fan again')) = 12600, 'due counts extra table price');
update bookings set status = 'no_show' where guest_name = 'Fan again';
select t_assert((select no_shows = 1 from guest_stats where guest_id = (select guest_id from bookings where guest_name = 'Fan')), 'guest_stats counts no-show');
update guests set tags = array['VIP'] where phone = '0811111111';
select t_assert((select tags = array['VIP'] from guests where phone = '0811111111'), 'staff can tag guests');
-- extra tables are validated
select t_expect_error($q$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone, extra_table_ids)
  select t.id, '2030-03-01 22:00+07', 60, 2, 'x', '0899999999', array[t.id] from tables t join layouts l on l.id = t.layout_id where l.name='Purpeech' and t.label='A4'$q$, 'invalid_extra_tables');
select t_expect_error($q$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone, extra_table_ids)
  select t.id, '2030-03-01 22:00+07', 60, 2, 'x', '0899999999', array[(select id from tables where kind='stage' limit 1)] from tables t join layouts l on l.id = t.layout_id where l.name='Purpeech' and t.label='A4'$q$, 'invalid_extra_tables');
-- staff cannot delete payments, manage products, or read logs; can write own logs
delete from booking_payments;
select t_assert((select count(*) from booking_payments) = 1, 'staff delete of payments blocked by RLS');
select t_expect_error($q$insert into products (name, price) values ('x', 1)$q$, 'row-level security');
insert into app_logs (level, event, message, context) values ('error', 'test.event', 'boom', '{"k":1}');
select t_assert((select count(*) from app_logs) = 0, 'staff cannot read logs');
select t_expect_error($q$insert into app_logs (level, event, user_id) values ('error', 'spoof', '00000000-0000-0000-0000-00000000000a')$q$, 'row-level security');
select t_login('00000000-0000-0000-0000-00000000000a');
select t_assert((select count(*) = 1 and bool_and(user_id = '00000000-0000-0000-0000-00000000000b') from app_logs), 'manager reads logs with user');
select t_assert((select count(*) from products) = 2, 'seeded products');
-- night switch remaps extra tables; archive guard covers extras
update bookings set extra_table_ids = array[(select t.id from tables t join layouts l on l.id = t.layout_id where l.name='Purpeech' and t.label='A5')] where guest_name = 'Fan';
select t_assert(booking_due((select id from bookings where guest_name = 'Fan')) = 6300 + 5800 + 1990, 'adding extra table updates due');
select t_assert((select not paid and amount_paid = 2000 from bookings where guest_name = 'Fan'), 'still partial after due grows');
select t_expect_error($q$update tables set archived = true where id = (select extra_table_ids[1] from bookings where guest_name = 'Fan')$q$, 'table_has_future_bookings');
select t_expect_error($q$select set_night_layout('2030-03-01', (select id from layouts where name = 'Normal'))$q$, 'unmapped_bookings');
select set_night_layout('2030-03-01', (select id from layouts where name = 'Normal'), jsonb_build_object(
  (select table_id::text from bookings where guest_name = 'Fan'), (select id from tables where layout_id = (select id from layouts where name='Normal') and label = 'T1'),
  (select extra_table_ids[1]::text from bookings where guest_name = 'Fan'), (select id from tables where layout_id = (select id from layouts where name='Normal') and label = 'T2')));
select t_assert((select t1.label = 'T1' and t2.label = 'T2' from bookings b join tables t1 on t1.id = b.table_id join tables t2 on t2.id = b.extra_table_ids[1] where b.guest_name = 'Fan'), 'night switch remaps main and extra tables');
reset role;

select 'PRESET TESTS PASSED' as result;
