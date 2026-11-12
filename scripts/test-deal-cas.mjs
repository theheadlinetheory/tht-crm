#!/usr/bin/env node
// Unit tests for js/deal-cas.js — card saves that cannot silently overwrite another writer (audit A3 #1, 2026-11-13).
// The fake database below behaves like `update … where id = ? and updated_at = ?` with a trigger that bumps
// updated_at on every write, so concurrent writers really interleave.
// Run: node scripts/test-deal-cas.mjs
import assert from 'node:assert/strict';
import { casSave, mergeNotes, planMerge, liveUpdate, CONFLICT_MARK } from '../js/deal-cas.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.stack}`); process.exitCode = 1; }
};

function fakeDb(row) {
  let v = 1;
  const db = { row: { ...row, updatedAt: 'v1' }, updates: 0, reads: 0 };
  db.write = (fields) => { Object.assign(db.row, fields); db.row.updatedAt = 'v' + (++v); };
  db.update = async (id, fields, seen) => {
    db.updates++;
    if (db.row.updatedAt !== seen) return null;
    db.write(fields);
    return db.row.updatedAt;
  };
  db.read = async () => { db.reads++; return { ...db.row }; };
  return db;
}

await test('no other writer: one update, only the changed field is sent', async () => {
  const db = fakeDb({ notes: 'a', phone: '1', company: 'Oak' });
  const sent = [];
  const update = (id, f, seen) => { sent.push(Object.keys(f)); return db.update(id, f, seen); };
  const r = await casSave({ id: 'd', fields: { phone: '2' }, base: { phone: '1' }, seen: 'v1', update, read: db.read });
  assert.equal(r.ok, true);
  assert.deepEqual(sent, [['phone']]);
  assert.equal(db.row.company, 'Oak');
  assert.equal(r.updatedAt, 'v2');
});

await test('merge: another SDR changed a different field → ours goes through, theirs kept', async () => {
  const db = fakeDb({ notes: 'a', phone: '1' });
  db.write({ notes: 'a\nlead said call Tues 3pm' });            // SDR B, after A opened the card
  const r = await casSave({ id: 'd', fields: { phone: '2' }, base: { phone: '1' }, seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, true);
  assert.equal(db.row.phone, '2');
  assert.equal(db.row.notes, 'a\nlead said call Tues 3pm');
});

await test('conflict: both changed the phone → nothing written, caller is told which field', async () => {
  const db = fakeDb({ phone: '1' });
  db.write({ phone: '555' });                                     // aimfox-webhook filled it
  const r = await casSave({ id: 'd', fields: { phone: '2' }, base: { phone: '1' }, seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ['phone']);
  assert.equal(r.fresh.phone, '555');
  assert.equal(db.row.phone, '555');
});

await test('append: B added a line while A typed one → both lines kept (the audit scenario)', async () => {
  const db = fakeDb({ notes: 'Callback card' });
  db.write({ notes: 'Callback card\nlead said call Tues 3pm' });   // B
  const r = await casSave({ id: 'd', fields: { notes: 'Callback card\nA: left voicemail' }, base: { notes: 'Callback card' },
    seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, true);
  assert.deepEqual(r.merged, ['notes']);
  assert.equal(db.row.notes, 'Callback card\nlead said call Tues 3pm\nA: left voicemail');
});

await test('append: calendly-webhook appended CANCELED while the SDR rewrote a line → SDR edit + webhook line', async () => {
  const db = fakeDb({ notes: 'call Tue' });
  db.write({ notes: 'call Tue\n[2026-11-13 10:00] Calendly booking CANCELED' });
  const r = await casSave({ id: 'd', fields: { notes: 'call Wed' }, base: { notes: 'call Tue' }, seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, true);
  assert.equal(db.row.notes, 'call Wed\n[2026-11-13 10:00] Calendly booking CANCELED');
});

await test('append: both rewrote the same text → both versions kept, theirs first, ours under a marker', async () => {
  assert.equal(mergeNotes('x', 'mine', 'theirs'), 'theirs\n\n' + CONFLICT_MARK + '\nmine');
});

await test('mergeNotes: identical / unchanged sides', () => {
  assert.equal(mergeNotes('a', 'a', 'a\nb'), 'a\nb');
  assert.equal(mergeNotes('a', 'a\nb', 'a'), 'a\nb');
  assert.equal(mergeNotes('a', 'a\nb', 'a\nb'), 'a\nb');
  assert.equal(mergeNotes('', 'mine', ''), 'mine');
  assert.equal(mergeNotes('', 'mine', 'theirs'), 'theirs\nmine');
});

await test('notes merge and a phone conflict together → reported as a conflict, nothing written', async () => {
  const db = fakeDb({ notes: 'a', phone: '1' });
  db.write({ notes: 'a\nb', phone: '9' });
  const r = await casSave({ id: 'd', fields: { notes: 'a\nc', phone: '2' }, base: { notes: 'a', phone: '1' }, seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ['phone']);
  assert.equal(db.row.notes, 'a\nb');
});

await test('a writer lands between our read and our retry → merged again, nothing lost', async () => {
  const db = fakeDb({ notes: 'a' });
  db.write({ notes: 'a\nb' });
  const read = async (id, keys) => { const r = await db.read(id, keys); if (db.reads === 1) db.write({ notes: 'a\nb\nc' }); return r; };
  const r = await casSave({ id: 'd', fields: { notes: 'a\nmine' }, base: { notes: 'a' }, seen: 'v1', update: db.update, read });
  assert.equal(r.ok, true);
  assert.equal(db.row.notes, 'a\nb\nc\nmine');
});

await test('unknown version (seen null) → read first, then compare-and-set', async () => {
  const db = fakeDb({ phone: '1' });
  const r = await casSave({ id: 'd', fields: { phone: '2' }, base: { phone: '1' }, seen: null, update: db.update, read: db.read });
  assert.equal(r.ok, true);
  assert.equal(db.reads, 1);
  assert.equal(db.row.phone, '2');
});

await test('their value already equals ours → nothing to write', async () => {
  const db = fakeDb({ phone: '1' });
  db.write({ phone: '2' });
  const r = await casSave({ id: 'd', fields: { phone: '2' }, base: { phone: '1' }, seen: 'v1', update: db.update, read: db.read });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, {});
});

await test('null and "" are the same value (the CRM normalises null to "")', () => {
  const p = planMerge({ fields: { website: 'x.com' }, base: { website: '' }, fresh: { website: null } });
  assert.deepEqual(p, { fields: { website: 'x.com' }, merged: [], conflicts: [] });
});

await test('live update: a field the user is not editing takes the new value; the edited one waits', () => {
  const card = { notes: 'a', phone: '1', company: 'Oak' };
  const r = liveUpdate(card, { notes: 'a\nb', phone: '555', company: 'Oak' }, { notes: 'a\nmine' }, { notes: 'a' });
  assert.deepEqual(r.apply, { phone: '555' });
  assert.equal(r.advance, false); // their notes change must still be caught by the save's compare-and-set
});

await test('live update: the echo of our own save may advance the version', () => {
  const card = { notes: 'a\nmine', phone: '1' };
  const r = liveUpdate(card, { notes: 'a', phone: '1', updatedAt: 'v9' }, { notes: 'a\nmine more' }, { notes: 'a' });
  assert.deepEqual(r.apply, {});
  assert.equal(r.advance, true);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
