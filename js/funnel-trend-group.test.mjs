import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDays, mondayOf, weekLabel, monthLabel, daysInMonth, avgComplete } from './funnel-trend-group.js';

// Oct 27 2026 is a Tuesday; Nov 2 is a Monday; Nov 10 is a Tuesday.
const days = (from, n, q = 1) => Array.from({ length: n }, (_, i) => {
  const day = new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10);
  return { day, positives: q + 1, qualified: q };
});

test('mondayOf finds the Monday of any day of the week', () => {
  assert.equal(mondayOf('2026-11-02'), '2026-11-02'); // Monday
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // Sunday still belongs to the Monday before
  assert.equal(mondayOf('2026-10-27'), '2026-10-26');
});

test('labels', () => {
  assert.equal(weekLabel('2026-11-02'), 'Nov 2–8');
  assert.equal(weekLabel('2026-10-26'), 'Oct 26–Nov 1');
  assert.equal(monthLabel('2026-05'), "May '26");
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-11'), 30);
});

test('weeks: a range starting mid-week yields a partial first week, full weeks in between, and the week holding today partial', () => {
  const rows = days('2026-10-27', 15); // Tue Oct 27 → Tue Nov 10
  const g = groupDays(rows, 'week', '2026-11-10');
  assert.deepEqual(g.map(x => [x.key, x.days, x.partial, x.qualified]), [
    ['2026-10-26', 6, true, 6],
    ['2026-11-02', 7, false, 7],
    ['2026-11-09', 2, true, 2],
  ]);
  assert.equal(g[1].positives, 14);
});

test('weeks: a full week not holding today is complete', () => {
  const g = groupDays(days('2026-11-02', 7), 'week', '2026-11-20');
  assert.equal(g.length, 1);
  assert.equal(g[0].partial, false);
});

test('months: whole months are complete, the first and last of a range can be partial', () => {
  const rows = days('2026-09-16', 56); // Sep 16 → Nov 10
  const g = groupDays(rows, 'month', '2026-11-10');
  assert.deepEqual(g.map(x => [x.key, x.days, x.expected, x.partial]), [
    ['2026-09', 15, 30, true],
    ['2026-10', 31, 31, false],
    ['2026-11', 10, 30, true],
  ]);
});

test('day: one group per row, only today partial', () => {
  const g = groupDays(days('2026-11-09', 2), 'day', '2026-11-10');
  assert.deepEqual(g.map(x => [x.key, x.partial]), [['2026-11-09', false], ['2026-11-10', true]]);
});

test('avgComplete ignores partial groups and is null with none complete', () => {
  const g = groupDays(days('2026-10-27', 15, 3), 'week', '2026-11-10');
  assert.equal(avgComplete(g), 21);
  assert.equal(avgComplete(g.filter(x => x.partial)), null);
});
