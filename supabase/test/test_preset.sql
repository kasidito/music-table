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
select t_assert((select count(*) from tables where kind <> 'table') = 3, 'stage, bar and door fixtures');
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a');
select t_expect_error($q$insert into bookings (table_id, start_at, duration_min, party_size, guest_name, phone)
  select id, '2030-02-01 21:00+07', 60, 2, 'a', '1' from tables where kind='stage' limit 1$q$, 'not_a_table');
select t_expect_error($q$insert into tables (layout_id, floor, label, seats) select id, 1, 'X', 0 from layouts where name='Normal'$q$, 'tables_seats_check');
select duplicate_layout((select id from layouts where name='Normal'), 'Copy');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Copy' and t.kind = 'stage' and t.w = 297) = 1, 'duplicate copies fixtures and sizes');
select t_assert((select count(*) from tables t join layouts l on l.id = t.layout_id where l.name = 'Copy') = 40, 'duplicate copies all 40 items');
reset role;

select 'PRESET TESTS PASSED' as result;
