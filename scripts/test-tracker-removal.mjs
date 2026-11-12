// node scripts/test-tracker-removal.mjs — archiving never asks to delete a delivered lead's tracker row,
// and a rebook replaces the deal's appointment (audit A1#1, A1#4, A3#8, A4#8 — Tim, 2026-11-13).
import assert from 'node:assert/strict';
import { shouldRequestTrackerRemoval, requestTrackerRemoval, DELIVERED_ARCHIVE_STATUSES } from '../js/tracker-removal.js';
import { replaceDealAppointment, saveDealAppointmentRow } from '../js/deal-appointment.js';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.stack || e)); process.exitCode = 1; }
}

await test('delivered statuses never ask for removal', async () => {
  assert.deepEqual(DELIVERED_ARCHIVE_STATUSES, ['Meeting Booked', 'Passed Off']);
  const calls = [];
  const invoke = (fn, body) => { calls.push([fn, body]); return Promise.resolve({ ok: true }); };
  for (const s of DELIVERED_ARCHIVE_STATUSES) {
    assert.equal(shouldRequestTrackerRemoval(s), false);
    assert.deepEqual(await requestTrackerRemoval(invoke, 'd1', s), { skipped: true });
  }
  assert.equal(calls.length, 0);
});

await test('real removals still ask (server decides about invoiced/paid rows)', async () => {
  const calls = [];
  const invoke = (fn, body) => { calls.push([fn, body]); return Promise.resolve({ ok: true }); };
  for (const s of ['Deleted/Lost', 'Removed — not qualified', 'Bad Lead', '', undefined]) {
    assert.equal(shouldRequestTrackerRemoval(s), true, String(s));
  }
  await requestTrackerRemoval(invoke, 'd2', 'Deleted/Lost');
  assert.deepEqual(calls, [['push-lead-tracker', { action: 'remove-lead', dealId: 'd2' }]]);
});

await test('a server refusal (409) is swallowed, never thrown into the archive flow', async () => {
  const invoke = () => Promise.reject(new Error('Not removed from the Lead Tracker: the tracker row is already invoiced.'));
  const r = await requestTrackerRemoval(invoke, 'd3', 'Deleted/Lost');
  assert.match(r.error, /invoiced/);
});

await test('rebook replaces the deal\'s previous appointment; deal-less rows are kept', () => {
  const list = [
    { id: 'a1', dealId: 'd1', apptDate: '2026-11-05' },
    { id: 'a2', dealId: null, apptDate: '2026-11-06' },
    { id: 'a3', dealId: 'd2', apptDate: '2026-11-07' },
  ];
  const out = replaceDealAppointment(list, { id: 'a4', dealId: 'd1', apptDate: '2026-11-12' });
  assert.deepEqual(out.map(a => a.id), ['a2', 'a3', 'a4']);
  const manual = replaceDealAppointment(out, { id: 'a5', dealId: null, apptDate: '2026-11-13' });
  assert.equal(manual.length, 4, 'a manual row without a deal never replaces anything');
});

await test('DB write upserts on deal_id when there is a deal, inserts otherwise, and throws on error', async () => {
  const ops = [];
  const db = { from: (t) => ({
    upsert: (row, o) => { ops.push(['upsert', t, row.deal_id, o.onConflict]); return Promise.resolve({ error: null }); },
    insert: (row) => { ops.push(['insert', t, row.deal_id]); return Promise.resolve({ error: row.fail ? { message: 'denied' } : null }); },
  }) };
  await saveDealAppointmentRow(db, { id: 'x', deal_id: 'd1' });
  await saveDealAppointmentRow(db, { id: 'y', deal_id: null });
  assert.deepEqual(ops, [['upsert', 'appointments', 'd1', 'deal_id'], ['insert', 'appointments', null]]);
  await assert.rejects(saveDealAppointmentRow(db, { id: 'z', deal_id: null, fail: true }));
});

await test('call sites: no bare remove-lead left in the files that archive', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['js/deals.js', 'js/rerun.js', 'js/email.js', 'js/booked-lead-routing.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.equal(/action:\s*'remove-lead'/.test(src), false, f + ' still calls remove-lead directly');
  }
  const routing = readFileSync(new URL('../js/booked-lead-routing.js', import.meta.url), 'utf8');
  assert.match(routing, /await autoPushToTracker\(deal\);[\s\S]*await deleteDeal\(deal\.id, 'Meeting Booked'/);
  const email = readFileSync(new URL('../js/email.js', import.meta.url), 'utf8');
  assert.match(email, /await invokeEdgeFunction\('sync-lead-tracker'/, 'sync-row is awaited before archiving');
  assert.match(email, /sheetResp\.warning/, 'push-to-client-sheet warning is shown');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
