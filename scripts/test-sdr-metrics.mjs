#!/usr/bin/env node
// Unit tests for js/sdr-metrics.js — the SDR Scorecard math (dials, active hours, breaks,
// utilization, connects, bookings). Import-free module, so node drives it directly.
// Run: node scripts/test-sdr-metrics.mjs
import assert from 'node:assert/strict';
import { etDay, dayStats, scorecard, GAP_MIN } from '../js/sdr-metrics.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// 2026-11-20 is EST (UTC-5): 10:00 ET = 15:00Z
const call = (hhmm, durationS = 60, disposition = 'no_answer', agentId = 1, day = '2026-11-20') => {
  const [h, m] = hhmm.split(':').map(Number);
  return { agentId, calledAt: `${day}T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`, durationS, disposition };
};
const SEATS = [{ agentId: 1, setter: 'Marcell', targetHours: 6, targetDials: 200 }];

test('GAP_MIN is 15', () => assert.equal(GAP_MIN, 15));

test('etDay buckets by Eastern time, not UTC', () => {
  assert.equal(etDay('2026-11-21T00:30:00Z'), '2026-11-20');
  assert.equal(etDay('2026-11-20T15:00:00Z'), '2026-11-20');
});

test('sessions split on gaps over 15 min; gap = next start − previous end', () => {
  const s = dayStats([call('10:00'), call('10:05'), call('10:50')]);
  assert.equal(s.dials, 3);
  near(s.activeH, 7 / 60); // [10:00–10:06] + [10:50–10:51]
  assert.equal(s.breaks.count, 1);
  assert.equal(s.breaks.longestMin, 44);
  assert.equal(s.breaks.minutes, 44);
});

test('a single call counts its own duration as active time', () => {
  const s = dayStats([call('10:00', 120)]);
  near(s.activeH, 120 / 3600);
  assert.equal(s.breaks.count, 0);
});

test('unsorted input gives the same answer', () => {
  const s = dayStats([call('10:50'), call('10:00'), call('10:05')]);
  near(s.activeH, 7 / 60);
});

test('connects follow the Cold Calling tab: not no answer / voicemail / bad number / desk DQ / blank', () => {
  const s = dayStats(['no_answer', 'desk_dq', '', 'bad_number', 'voicemail', 'booked', 'not_interested']
    .map((d, i) => call(`10:0${i}`, 30, d)));
  assert.equal(s.connects, 2);
});

test('talk time sums durations', () => {
  near(dayStats([call('10:00', 1800), call('10:40', 1800)]).talkH, 1);
});

test('utilization = active hours ÷ target hours; dials under target flagged', () => {
  const calls = [call('09:00', 0), call('09:10', 0), call('09:20', 0), call('09:30', 0),
    call('09:40', 0), call('09:50', 0), call('10:00', 0), call('10:10', 0), call('10:20', 0),
    call('10:30', 0), call('10:40', 0), call('10:50', 0), call('11:00', 0), call('11:10', 0),
    call('11:20', 0), call('11:30', 0), call('11:40', 0), call('11:50', 0), call('12:00', 0)];
  const [m] = scorecard({ calls, seats: SEATS, bookings: [], from: '2026-11-20', to: '2026-11-20' });
  const d = m.days[0];
  near(d.activeH, 3);
  near(d.utilization, 0.5);
  assert.equal(d.underTarget, true);
  assert.ok(Number.isFinite(d.dialsPerActiveH));
});

test('no bookings → dialsPerBooking null, connToBook 0', () => {
  const [m] = scorecard({ calls: [call('10:00', 60, 'not_interested')], seats: SEATS, bookings: [], from: '2026-11-20', to: '2026-11-20' });
  assert.equal(m.days[0].dialsPerBooking, null);
  assert.equal(m.days[0].connToBook, 0);
  assert.equal(m.totals.dialsPerBooking, null);
});

test('a booking on a day with no dials still gets a zero row, never NaN', () => {
  const [m] = scorecard({ calls: [], seats: SEATS, bookings: [{ setter: 'Marcell', day: '2026-11-21' }], from: '2026-11-20', to: '2026-11-21' });
  assert.equal(m.days.length, 1);
  const d = m.days[0];
  assert.equal(d.day, '2026-11-21');
  assert.equal(d.dials, 0);
  assert.equal(d.booked, 1);
  assert.equal(d.utilization, 0);
  assert.equal(d.connectRate, 0);
  for (const v of Object.values(d)) if (typeof v === 'number') assert.ok(Number.isFinite(v), JSON.stringify(d));
});

test('days with nothing are left out; calls and bookings outside the range ignored', () => {
  const [m] = scorecard({
    calls: [call('10:00', 60, 'no_answer', 1, '2026-11-19'), call('10:00', 60, 'no_answer', 1, '2026-11-20')],
    seats: SEATS, bookings: [{ setter: 'Marcell', day: '2026-11-18' }], from: '2026-11-20', to: '2026-11-22',
  });
  assert.deepEqual(m.days.map((d) => d.day), ['2026-11-20']);
  assert.equal(m.totals.booked, 0);
});

test('calls from a login with no seat are not counted', () => {
  const [m] = scorecard({ calls: [call('10:00', 60, 'no_answer', 99)], seats: SEATS, bookings: [], from: '2026-11-20', to: '2026-11-20' });
  assert.equal(m.days.length, 0);
  assert.equal(m.totals.dials, 0);
});

test('totals: sums, and per-day averages over days with at least one dial', () => {
  const calls = [call('10:00', 60, 'not_interested', 1, '2026-11-19'), call('10:05', 60, 'no_answer', 1, '2026-11-19'),
    call('10:00', 60, 'booked', 1, '2026-11-20'), call('10:05', 60, 'no_answer', 1, '2026-11-20')];
  const bookings = [{ setter: 'Marcell', day: '2026-11-20' }, { setter: 'Marcell', day: '2026-11-21' }];
  const [m] = scorecard({ calls, seats: SEATS, bookings, from: '2026-11-19', to: '2026-11-21' });
  const t = m.totals;
  assert.equal(t.dials, 4);
  assert.equal(t.dialDays, 2);
  assert.equal(t.dialsPerDay, 2);
  assert.equal(t.booked, 2);
  assert.equal(t.connects, 2);
  near(t.connectRate, 0.5);
  assert.equal(t.dialsPerBooking, 2);
  near(t.activeHPerDay, 6 / 60);
  near(t.utilization, (6 / 60) / 6);
});

test('one result per seat, in seat order, carrying targets', () => {
  const seats = [...SEATS, { agentId: 2, setter: 'Ioannis', targetHours: 6, targetDials: 200 }];
  const out = scorecard({ calls: [call('10:00', 60, 'no_answer', 2)], seats, bookings: [], from: '2026-11-20', to: '2026-11-20' });
  assert.deepEqual(out.map((s) => s.setter), ['Marcell', 'Ioannis']);
  assert.equal(out[1].totals.dials, 1);
  assert.equal(out[1].targetDials, 200);
});

test('a precomputed ET day on the call is used as-is (no per-render timezone work)', () => {
  const c = { ...call('10:00', 60, 'no_answer', 1, '2026-11-20'), day: '2026-11-19' };
  const [m] = scorecard({ calls: [c], seats: SEATS, bookings: [], from: '2026-11-19', to: '2026-11-19' });
  assert.equal(m.totals.dials, 1);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
