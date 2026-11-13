import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourWeekWindows, mondayOf, isLastFridayOfMonth, rangeLabel, trendOf } from './analysis-month-window.js';

test('4 weeks ending with the selected week vs the 4 weeks before', () => {
  // Last Friday of November 2026 is Nov 27, in the week of Mon Nov 23.
  const w = fourWeekWindows(mondayOf(new Date(2026, 10, 27)));
  assert.deepEqual([w.cur.start, w.cur.end, w.cur.days], ['2026-11-02', '2026-11-29', 28]);
  assert.deepEqual([w.prev.start, w.prev.end, w.prev.days], ['2026-10-05', '2026-11-01', 28]);
  assert.equal(rangeLabel(w.cur), 'Nov 2 – 29');
  assert.equal(rangeLabel(w.prev), 'Oct 5 – Nov 1');
  assert.deepEqual(w.weeks, ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  assert.deepEqual(w.cur.weeks, w.weeks.slice(4));
  assert.deepEqual(w.prev.weeks, w.weeks.slice(0, 4));
});

test('window can start in the previous month (Sep 25 2026 → Aug 31)', () => {
  const w = fourWeekWindows(mondayOf(new Date(2026, 8, 25)));
  assert.equal(w.cur.start, '2026-08-31');
  assert.equal(w.cur.end, '2026-09-27');
});

test('windows cross a year boundary', () => {
  const w = fourWeekWindows('2027-01-25');
  assert.equal(w.cur.start, '2027-01-04');
  assert.equal(w.prev.start, '2026-12-07');
  assert.equal(w.prev.end, '2027-01-03');
  assert.equal(rangeLabel(w.prev), 'Dec 7 – Jan 3');
});

test('windows are 28 days across a DST change', () => {
  const w = fourWeekWindows('2026-11-23'); // US DST ends Nov 1 2026, inside prev
  assert.equal(w.prev.start, '2026-10-05');
  assert.equal(w.prev.end, '2026-11-01');
});

test('mondayOf', () => {
  assert.equal(mondayOf(new Date(2026, 10, 29)), '2026-11-23'); // Sunday
  assert.equal(mondayOf(new Date(2026, 10, 23)), '2026-11-23'); // Monday
});

test('last Friday of the month', () => {
  assert.equal(isLastFridayOfMonth(new Date(2026, 10, 27)), true);  // Nov 27
  assert.equal(isLastFridayOfMonth(new Date(2026, 10, 20)), false); // a Friday, not the last
  assert.equal(isLastFridayOfMonth(new Date(2026, 10, 26)), false); // Thursday
  assert.equal(isLastFridayOfMonth(new Date(2026, 9, 30)), true);   // Oct 30
});

test('trend', () => {
  assert.deepEqual(trendOf(5, 4), { dir: 'up', diff: 1, pct: 25 });
  assert.deepEqual(trendOf(0, 3), { dir: 'down', diff: -3, pct: -100 });
  assert.deepEqual(trendOf(2, 0), { dir: 'up', diff: 2, pct: null });
});
