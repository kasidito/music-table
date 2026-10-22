import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/time.js';

const S = { open_time: '18:00:00', close_time: '02:00:00', default_duration_min: 120 };
const ms = (s) => Date.parse(s);

test('night: after midnight before close belongs to previous night', () => {
  assert.equal(T.nightOf(ms('2030-01-11T01:30:00+07:00'), S), '2030-01-10');
  assert.equal(T.nightOf(ms('2030-01-10T20:00:00+07:00'), S), '2030-01-10');
  assert.equal(T.nightOf(ms('2030-01-11T02:00:00+07:00'), S), '2030-01-11');
});

test('night: bar that closes before midnight', () => {
  const day = { open_time: '10:00:00', close_time: '22:00:00' };
  assert.equal(T.nightOf(ms('2030-01-11T01:30:00+07:00'), day), '2030-01-11');
});

test('night time to instant crosses midnight', () => {
  assert.equal(T.nightTimeToMs('2030-01-10', '01:00', S), ms('2030-01-11T01:00:00+07:00'));
  assert.equal(T.nightTimeToMs('2030-01-10', '23:15', S), ms('2030-01-10T23:15:00+07:00'));
});

test('slots run from open to close', () => {
  const s = T.slots(S, 30);
  assert.equal(s[0], '18:00');
  assert.equal(s.at(-1), '01:30');
  assert.equal(s.length, 16);
});

const b = (id, table, start, dur, status = 'booked', extra = {}) =>
  ({ id, table_id: table, start_at: new Date(ms(start)).toISOString(), duration_min: dur, status, party_size: 2, is_walk_in: false, ...extra });

test('conflicts: overlap on same active table only', () => {
  const list = [
    b('1', 'A', '2030-01-10T20:00:00+07:00', 120),
    b('2', 'A', '2030-01-10T22:00:00+07:00', 60, 'cancelled'),
    b('3', 'B', '2030-01-10T20:30:00+07:00', 60),
  ];
  const draft = b(undefined, 'A', '2030-01-10T21:00:00+07:00', 60);
  assert.deepEqual(T.conflictsFor(draft, list).map((x) => x.id), ['1']);
  const touching = b(undefined, 'A', '2030-01-10T22:00:00+07:00', 60);
  assert.equal(T.conflictsFor(touching, list).length, 0, 'back-to-back is not an overlap');
  assert.equal(T.conflictsFor({ ...list[0] }, list).length, 0, 'editing a booking ignores itself');
});

test('table state at time', () => {
  const list = [
    b('1', 'A', '2030-01-10T20:00:00+07:00', 60),
    b('2', 'B', '2030-01-10T19:00:00+07:00', 60, 'seated'),
  ];
  assert.equal(T.tableStateAt('A', list, ms('2030-01-10T19:00:00+07:00')).state, 'free');
  assert.equal(T.tableStateAt('A', list, ms('2030-01-10T19:00:00+07:00')).next.id, '1');
  assert.equal(T.tableStateAt('A', list, ms('2030-01-10T20:10:00+07:00')).state, 'booked');
  assert.equal(T.tableStateAt('A', list, ms('2030-01-10T20:30:00+07:00')).state, 'late');
  assert.equal(T.tableStateAt('B', list, ms('2030-01-10T23:00:00+07:00')).state, 'seated', 'seated holds table past its end');
  assert.equal(T.tableStateAt('C', list, ms('2030-01-10T23:00:00+07:00')).state, 'free');
});

test('nightly summary', () => {
  const list = [
    b('1', 'A', '2030-01-10T20:00:00+07:00', 60, 'done', { party_size: 4 }),
    b('2', 'A', '2030-01-10T22:00:00+07:00', 60, 'cancelled', { party_size: 3 }),
    b('3', 'B', '2030-01-10T20:00:00+07:00', 60, 'no_show', { party_size: 2 }),
    b('4', 'C', '2030-01-10T21:00:00+07:00', 60, 'seated', { party_size: 5, is_walk_in: true }),
    b('5', 'D', '2030-01-11T01:00:00+07:00', 60, 'booked', { party_size: 2 }),
  ];
  assert.deepEqual(T.summary(list), { bookings: 4, guests: 9, walkIns: 1, cancelled: 1, noShows: 1 });
});

test('late after 15 minutes, until the slot ends', () => {
  const x = b('1', 'A', '2030-01-10T20:00:00+07:00', 120);
  assert.equal(T.isLate(x, ms('2030-01-10T20:14:00+07:00')), false);
  assert.equal(T.isLate(x, ms('2030-01-10T20:15:00+07:00')), true);
  assert.equal(T.isLate(x, ms('2030-01-10T22:00:00+07:00')), false);
  assert.equal(T.isLate({ ...x, status: 'seated' }, ms('2030-01-10T20:30:00+07:00')), false);
  assert.equal(T.tableStateAt('A', [x], ms('2030-01-10T20:30:00+07:00')).state, 'late');
});

test('upcoming: late first, then by time; tables booked ignores cancelled', () => {
  const list = [
    b('1', 'A', '2030-01-10T22:00:00+07:00', 60),
    b('2', 'B', '2030-01-10T20:00:00+07:00', 120),
    b('3', 'C', '2030-01-10T21:30:00+07:00', 60),
    b('4', 'D', '2030-01-10T21:00:00+07:00', 60, 'seated'),
    b('5', 'E', '2030-01-10T23:00:00+07:00', 60, 'cancelled'),
  ];
  assert.deepEqual(T.upcoming(list, ms('2030-01-10T21:00:00+07:00')).map((x) => x.id), ['2', '3', '1']);
  assert.equal(T.tablesBooked(list), 4);
});
