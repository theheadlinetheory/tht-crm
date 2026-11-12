// node scripts/test-passoff-core.mjs — the pass-off panel's decisions (js/passoff-core.js).
// Pass-off buttons looked dead / double-sent after a re-render (Tim, 2026-11-12).
import assert from 'node:assert/strict';
import {
  createInFlight, buttonState, textLocked, onScreenText, reviseBody, checkDraft,
  mayHaveFinished, recoveredDrafts, isAlreadySent, sendOnce, zonedDateTime, BUSY_LABELS,
} from '../js/passoff-core.js';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.stack || e)); process.exitCode = 1; }
}

await test('duplicate click is ignored while the first request runs', () => {
  const host = {};
  const f = createInFlight(host);
  assert.equal(f.begin('d1', 'generate'), true);
  assert.equal(f.begin('d1', 'generate'), false, 'second generate ignored');
  assert.equal(f.begin('d1', 'send'), false, 'send ignored while generating');
  assert.equal(f.begin('d2', 'generate'), true, 'another deal is not blocked');
  assert.equal(host.__crmBusy, 2);
  f.end('d1', 'generate');
  f.end('d1', 'generate'); // double end must not drive the counter negative
  assert.equal(host.__crmBusy, 1);
  assert.equal(f.begin('d1', 'send'), true);
});

await test('deal ids compare as strings (numeric id vs "123" from an onclick)', () => {
  const f = createInFlight(null);
  f.begin(123, 'send');
  assert.equal(f.has('123', 'send'), true);
  assert.equal(f.begin('123', 'send'), false);
});

await test('a re-render keeps the buttons disabled and labelled from the map', () => {
  const f = createInFlight(null);
  f.begin('d1', 'generate');
  // A fresh render (realtime / 2-min sync / tab focus) asks the map, not the old DOM.
  assert.deepEqual(buttonState(f, 'd1', 'generate', 'Start over'), { disabled: true, label: BUSY_LABELS.generate });
  assert.deepEqual(buttonState(f, 'd1', 'send', 'Send pass-off to client'), { disabled: true, label: 'Send pass-off to client' });
  assert.deepEqual(buttonState(f, 'd2', 'generate', 'Start over'), { disabled: false, label: 'Start over' });
  assert.equal(textLocked(f, 'd1'), true, 'pass-off boxes locked while Claude writes');
  f.end('d1', 'generate');
  assert.deepEqual(buttonState(f, 'd1', 'generate', 'Start over'), { disabled: false, label: 'Start over' });
  assert.equal(textLocked(f, 'd1'), false);
  f.begin('d1', 'send');
  assert.equal(textLocked(f, 'd1'), false, 'sending does not lock the boxes');
  assert.equal(buttonState(f, 'd1', 'send', 'x').label, 'Sending…');
});

await test('empty draft in a 200 throws', () => {
  assert.throws(() => checkDraft({ instructions: '' }), /empty draft/);
  assert.throws(() => checkDraft({ instructions: '   ' }), /empty draft/);
  assert.throws(() => checkDraft({}), /empty draft/);
  assert.throws(() => checkDraft({ error: 'Claude refused' }), /Claude refused/);
  assert.throws(() => checkDraft(null), /No response/);
  assert.equal(checkDraft({ instructions: 'Hi' }).instructions, 'Hi');
});

await test('revise sends the on-screen drafts, not the saved copy', () => {
  const b = reviseBody('d1', 'Woody', 'make it Thursday', [], 'typed client text', 'typed lead text');
  assert.deepEqual(b.drafts, { client_message: 'typed client text', lead_message: 'typed lead text' });
  assert.equal(b.mode, 'revise');
  assert.equal(b.instruction, 'make it Thursday');
  // No box on screen: no drafts, the server falls back to the DB row.
  assert.equal('drafts' in reviseBody('d1', 'Woody', 'x', [], null, null), false);
  // An emptied box is still what is on screen.
  assert.deepEqual(reviseBody('d1', 'W', 'x', [], '', null).drafts, { client_message: '', lead_message: '' });
});

await test('on-screen text wins over the deal copies (send + call-point ticks)', () => {
  assert.equal(onScreenText('box', 'row', 'open'), 'box');
  assert.equal(onScreenText('  ', 'row', 'open'), 'row');
  assert.equal(onScreenText(undefined, '', 'open'), 'open');
  assert.equal(onScreenText(null, undefined, null), '');
});

await test('timeout recovery: shows what the server saved, else still an error', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(mayHaveFinished(abort), true);
  assert.equal(mayHaveFinished(new TypeError('Failed to fetch')), true);
  assert.equal(mayHaveFinished(new Error('generate-passoff returned 502')), false, 'a real server error is not retried by re-reading');
  assert.equal(recoveredDrafts(null, ''), null);
  assert.equal(recoveredDrafts({ passoff_instructions: 'old' }, 'old'), null, 'nothing new written');
  assert.equal(recoveredDrafts({ passoff_instructions: '' }, ''), null);
  assert.deepEqual(recoveredDrafts({ passoff_instructions: 'new', passoff_lead_message: 'L', call_points: 'a\nb' }, 'old'),
    { instructions: 'new', leadMessage: 'L', callPoints: 'a\nb' });
  assert.equal(recoveredDrafts({ passoff_instructions: 'new' }, '').callPoints, undefined);
});

await test('409 already_sent asks first, then resends with resend:true', async () => {
  const calls = [];
  const invoke = async b => { calls.push(b); if (!b.resend) throw new Error('already_sent'); return { ok: true }; };
  let asked = '';
  const r = await sendOnce(invoke, { action: 'send_to_client_thread', dealId: 'd1' },
    { confirm: m => { asked = m; return true; }, clientName: "Woody's", sentAt: '11/12/2026, 3:04 PM' });
  assert.deepEqual(r, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].resend, true);
  assert.match(asked, /Already sent to Woody's at 11\/12\/2026, 3:04 PM\. Send again\?/);
});

await test('409 already_sent + "no" sends nothing more', async () => {
  const calls = [];
  const invoke = async b => { calls.push(b); throw new Error('already_sent'); };
  const r = await sendOnce(invoke, { dealId: 'd1' }, { confirm: () => false, clientName: 'X', sentAt: '' });
  assert.equal(r, null);
  assert.equal(calls.length, 1);
});

await test('already_sent returned as a body (no throw) is handled the same', async () => {
  const calls = [];
  const invoke = async b => { calls.push(b); return b.resend ? { ok: true } : { ok: false, error: 'already_sent', sentAt: '2026-11-12T15:00:00Z' }; };
  let asked = '';
  await sendOnce(invoke, {}, { confirm: m => { asked = m; return true; }, clientName: 'X', sentAt: '' });
  assert.match(asked, /2026-11-12T15:00:00Z/);
  assert.equal(calls[1].resend, true);
});

await test('other send errors are thrown, not confirmed', async () => {
  await assert.rejects(sendOnce(async () => { throw new Error('No email configured for client'); }, {},
    { confirm: () => { throw new Error('should not ask'); }, clientName: 'X' }), /No email configured/);
  assert.equal(isAlreadySent({ error: 'already_sent' }), true);
  assert.equal(isAlreadySent({ error: 'other' }), false);
});

await test('first send passes straight through', async () => {
  const r = await sendOnce(async () => ({ ok: true, id: 1 }), {}, { confirm: () => { throw new Error('no'); }, clientName: 'X' });
  assert.deepEqual(r, { ok: true, id: 1 });
});

await test('Calendly start_time lands on the client clock, not the browser clock', () => {
  // 15:30 UTC = 10:30 in New York (EST: US daylight time ended 2026-11-01).
  assert.deepEqual(zonedDateTime('2026-11-12T15:30:00Z', 'America/New_York'), { date: '2026-11-12', time: '10:30' });
  assert.deepEqual(zonedDateTime('2026-11-12T15:30:00Z', 'America/Los_Angeles'), { date: '2026-11-12', time: '07:30' });
  // Crosses midnight in the client's zone.
  assert.deepEqual(zonedDateTime('2026-11-13T03:00:00Z', 'America/Chicago'), { date: '2026-11-12', time: '21:00' });
  assert.deepEqual(zonedDateTime('2026-11-12T00:15:00Z', 'Europe/London'), { date: '2026-11-12', time: '00:15' }, 'midnight is 00, not 24');
  // No zone / bad zone: browser clock, still well-formed.
  assert.match(zonedDateTime('2026-11-12T15:30:00Z', null).time, /^\d\d:\d\d$/);
  assert.match(zonedDateTime('2026-11-12T15:30:00Z', 'Not/AZone').date, /^\d{4}-\d\d-\d\d$/);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
