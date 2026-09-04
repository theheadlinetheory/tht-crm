#!/usr/bin/env node
// Unit tests for js/weekly-template.js — the pure text half of Weekly Updates
// (greeting rule + template tokens). Import-free like weekly-context.js, so
// node can load it. Run: node scripts/test-weekly-template.mjs
import assert from 'node:assert/strict';
import { weeklyGreeting, applyWeeklyTemplate, PPM_NOTE, DEFAULT_WEEKLY_UPDATE_TEMPLATE, WEEKLY_TOKENS } from '../js/weekly-template.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── Greeting: "Team" whenever more than one client address is on the email,
//    To or Cc alike. Only internal @theheadlinetheory.com addresses are ignored.
test('two To addresses, no Cc → Team (the 2026-09-04 bug: Denair, Landry\'s)', () => {
  assert.equal(weeklyGreeting('Dennis', 'dennisc@denairhvac.com, katrinn@denairhvac.com', []), 'Team');
});
test('one To + internal aidan@ Cc → first name', () => {
  assert.equal(weeklyGreeting('Reuven', 'reuven@clearheatingandair.com', ['aidan@theheadlinetheory.com']), 'Reuven');
});
test('one To + one external Cc → Team (pre-existing behaviour kept)', () => {
  assert.equal(weeklyGreeting('Heath', 'heath@dallaslandcare.com', ['aidan@theheadlinetheory.com', 'pdirlis@gmail.com']), 'Team');
});
test('a Cc that duplicates the To address does not double-count', () => {
  assert.equal(weeklyGreeting('Scott', 'scott@peakservicesco.com', ['Scott@PeakServicesCo.com']), 'Scott');
});
test('three To addresses → Team', () => {
  assert.equal(weeklyGreeting('Scott', 'scott@peakservicesco.com, mak@peakservicesco.com, office@peakservicesco.com', []), 'Team');
});
test('semicolon / whitespace separated To is counted per address', () => {
  assert.equal(weeklyGreeting('Chris', 'a@x.com; b@x.com', []), 'Team');
});
test('no first name and a single address → "there"', () => {
  assert.equal(weeklyGreeting('', 'a@x.com', []), 'there');
});
test('missing Cc list is tolerated', () => {
  assert.equal(weeklyGreeting('Jon', 'contact@lightninglawncare.co', undefined), 'Jon');
});

// ── {PPM_NOTE}: pay-per-meeting clients only, inline right after the stats.
const LIVE_TPL = 'Hey {CLIENT_FIRST},\n\nQuick end of week update.\n\nThis week we sent {SENT} emails, got {REPLIES} responses, and {POSITIVES} positive responses. {PPM_NOTE}\n\nHave an awesome weekend!';
const ctx = { first: 'Reuven', name: 'Clear Heating & Air, Inc.', sent: 2957, replies: 36, positives: 5, rangeLabel: 'Aug 29 – Sep 4' };

test('pay-per-meeting: the sentence follows the stats in the same paragraph', () => {
  assert.equal(applyWeeklyTemplate(LIVE_TPL, { ...ctx, ppm: true }),
    'Hey Reuven,\n\nQuick end of week update.\n\nThis week we sent 2957 emails, got 36 responses, and 5 positive responses. Still in talks with some of them to figure out meeting times.\n\nHave an awesome weekend!');
});
test('retainer: no sentence and no dangling space before the blank line', () => {
  assert.equal(applyWeeklyTemplate(LIVE_TPL, { ...ctx, first: 'Dennis', ppm: false }),
    'Hey Dennis,\n\nQuick end of week update.\n\nThis week we sent 2957 emails, got 36 responses, and 5 positive responses.\n\nHave an awesome weekend!');
});
test('PPM_NOTE is the exact requested wording', () => {
  assert.equal(PPM_NOTE, 'Still in talks with some of them to figure out meeting times.');
});
test('default template carries the token, not a hardcoded sentence; token list advertises it', () => {
  assert.ok(DEFAULT_WEEKLY_UPDATE_TEMPLATE.includes('{POSITIVES} positive responses. {PPM_NOTE}'));
  assert.ok(!DEFAULT_WEEKLY_UPDATE_TEMPLATE.includes('Still in talks'));
  assert.ok(WEEKLY_TOKENS.includes('{PPM_NOTE}'));
});
test('a template without the token renders identically for both billing models', () => {
  const tpl = 'Hey {CLIENT_FIRST}, {SENT} sent.';
  assert.equal(applyWeeklyTemplate(tpl, { ...ctx, ppm: true }), 'Hey Reuven, 2957 sent.');
  assert.equal(applyWeeklyTemplate(tpl, { ...ctx, ppm: false }), 'Hey Reuven, 2957 sent.');
});
test('every advertised token is substituted (none survive into the body)', () => {
  const tpl = WEEKLY_TOKENS.join(' | ');
  const out = applyWeeklyTemplate(tpl, { ...ctx, ppm: true });
  for (const t of WEEKLY_TOKENS) assert.ok(!out.includes(t), `${t} leaked`);
});

console.log(`\n${passed} passed${process.exitCode ? ' — with FAILURES' : ''}`);
