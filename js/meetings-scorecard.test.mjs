import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeetingsScorecard, periodsFor, parseTrackerDate, paceStatus } from './meetings-scorecard.js';

const isEmail = e => e.leadSource !== 'cold_call';
const today = new Date(2026, 10, 23); // Mon Nov 23 2026

test('week is Mon–Sun containing today, month is the calendar month', () => {
  const p = periodsFor(new Date(2026, 10, 25));
  assert.equal(p.weekStart.getDate(), 23);
  assert.equal(p.weekEnd.getDate(), 29);
  assert.equal(p.monthStart.getDate(), 1);
  assert.equal(p.daysInMonth, 30);
  // Sunday belongs to the week that started the Monday before
  assert.equal(periodsFor(new Date(2026, 10, 22)).weekStart.getDate(), 16);
});

test('parses M/D/YY and M/D/YYYY, rejects junk', () => {
  assert.equal(parseTrackerDate('11/3/26').getTime(), new Date(2026, 10, 3).getTime());
  assert.equal(parseTrackerDate('11/03/2026').getTime(), new Date(2026, 10, 3).getTime());
  assert.equal(parseTrackerDate('2026-11-03'), null);
  assert.equal(parseTrackerDate(''), null);
});

test('splits cold email vs cold call, week vs month, every PPM client gets a row', () => {
  const entries = [
    { clientName: 'Coastal Lawn Care', dateAdded: '11/2/26' },
    { clientName: 'Coastal Lawn Care', dateAdded: '11/23/26', leadSource: 'cold_call' },
    { clientName: 'Coastal Lawn Care', dateAdded: '11/10/26', leadSource: 'cold_call' },
    { clientName: 'Coastal Lawn Care', dateAdded: '10/30/26' },               // last month
    { clientName: 'Timesavers', dateAdded: '11/23/26' },
    { clientName: 'Timesavers', dateAdded: '11/24/26' },                       // future: ignored
    { clientName: 'Retainer Co', dateAdded: '11/23/26' },                      // not PPM
  ];
  const { rows } = buildMeetingsScorecard({ entries, clientNames: ['Coastal Lawn Care', 'Timesavers', 'Clear'], isEmail, today });
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.deepEqual(
    [by['Coastal Lawn Care'].emailWeek, by['Coastal Lawn Care'].emailMonth, by['Coastal Lawn Care'].callWeek, by['Coastal Lawn Care'].callMonth],
    [0, 1, 1, 2]);
  assert.equal(by['Coastal Lawn Care'].totalMonth, 3);
  assert.equal(by['Coastal Lawn Care'].needed, 5);
  assert.equal(by.Timesavers.totalWeek, 1);
  assert.equal(by.Clear.totalMonth, 0);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Clear'); // most behind first
});

test('a week spanning two months counts the prior month days in the week only', () => {
  // Tue Dec 1 2026: week started Mon Nov 30
  const entries = [{ clientName: 'A', dateAdded: '11/30/26' }];
  const { rows } = buildMeetingsScorecard({ entries, clientNames: ['A'], isEmail, today: new Date(2026, 11, 1) });
  assert.equal(rows[0].emailWeek, 1);
  assert.equal(rows[0].emailMonth, 0);
});

test('resolveName maps tracker spellings onto the client', () => {
  const entries = [{ clientName: 'coastal', dateAdded: '11/5/26' }];
  const { rows } = buildMeetingsScorecard({
    entries, clientNames: ['Coastal Lawn Care'], isEmail, today,
    resolveName: n => (n.toLowerCase().startsWith('coastal') ? 'Coastal Lawn Care' : n),
  });
  assert.equal(rows[0].emailMonth, 1);
});

test('pace status', () => {
  // Nov 23: 8 × 23/30 ≈ 6.13 expected
  assert.equal(paceStatus(7, 6.13), 'ahead');
  assert.equal(paceStatus(6, 6.13), 'close');
  assert.equal(paceStatus(4, 6.13), 'behind');
});
