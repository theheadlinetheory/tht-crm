// ═══════════════════════════════════════════════════════════
// DEAL-CAS — card edits that cannot silently overwrite someone else's (audit A3 #1, 2026-11-13)
// ═══════════════════════════════════════════════════════════
// Import-free so node can test it (scripts/test-deal-cas.mjs). deal-modal.js supplies the database calls.
//
// Before: an open card held back every realtime event, and its saves wrote whole values (doSaveDeal wrote all ten
// form fields, touched or not). SDR B's note, calendly-webhook's "Booking CANCELED" line or aimfox's phone were
// overwritten the moment SDR A typed one character, and A never saw them.
//
// Now every card save is a compare-and-set:
//   1. send ONLY the changed fields, `where updated_at = <the version this tab last saw>` (deals.updated_at is bumped
//      on every update by trg_deals_updated_at, migration 20261113000300);
//   2. 0 rows → someone else wrote the card. Re-read the fields we are saving and, per field:
//        - theirs still equals what we started from (`base`) → they changed other fields; ours goes through;
//        - theirs equals ours → nothing to do;
//        - notes → merged, never overwritten (mergeNotes below);
//        - anything else → a real conflict: the caller asks "Someone else changed this card — reload?";
//   3. retry against the version just read (a few times; each miss means yet another writer).
//
// Notes — why append, not "show both and make the SDR pick": notes are a running log that several writers add to
// (SDRs, calendly-webhook, cold-call-sync's reminders). Nearly every concurrent edit is two additions, and those
// merge exactly: their text, then the line this SDR added. Only when both sides changed the SAME existing text do we
// keep both versions, theirs first and ours under a marker. A duplicated paragraph is visible and takes a second to
// tidy; an overwritten one is gone without anyone knowing.

const s = (v) => (v == null ? '' : String(v));
export const same = (a, b) => s(a) === s(b);

export const CONFLICT_MARK = '— Your edit (someone else changed these notes at the same time; both kept) —';

/** Merge two edits of one notes field that both started from `base`. Never drops either side's text. */
export function mergeNotes(base, mine, theirs) {
  const b = s(base), m = s(mine), t = s(theirs);
  if (m === t || m === b) return t;            // nothing of ours left to add
  if (t === b) return m;                       // they did not touch notes
  const join = (head, tail) => {
    const add = tail.replace(/^\n+/, '');
    if (!add) return head;
    return head.endsWith('\n') || !head ? head + add : head + '\n' + add;
  };
  if (m.startsWith(b)) return join(t, m.slice(b.length));   // we only added: their version + our addition
  if (t.startsWith(b)) return join(m, t.slice(b.length));   // they only added: our edit + their addition
  return t + '\n\n' + CONFLICT_MARK + '\n' + m;              // both rewrote the same text: keep both
}

/**
 * Decide, per field, what a save does now that `fresh` (the row as the server has it) is known.
 * Returns the fields still to write, the merged keys, and the keys that conflict.
 */
export function planMerge({ fields, base, fresh, appendable = ['notes'] }) {
  const out = {}, merged = [], conflicts = [];
  for (const k of Object.keys(fields)) {
    const mine = fields[k], theirs = fresh[k], b = base[k];
    if (same(theirs, mine)) continue;                         // already there
    if (same(theirs, b)) { out[k] = mine; continue; }         // they left this field alone
    if (appendable.includes(k)) { out[k] = mergeNotes(b, mine, theirs); merged.push(k); continue; }
    conflicts.push(k);
    out[k] = mine;
  }
  return { fields: out, merged, conflicts };
}

/**
 * Compare-and-set save of `fields` on deal `id`.
 *   update(id, fields, seen) → Promise<string|null>: the new updated_at, or null when 0 rows matched.
 *   read(id, keys)           → Promise<{ ...keys, updatedAt }>: the row as it is now.
 *   seen  = the updated_at this tab last saw for the card (null/unknown → read first).
 *   base  = each field's value before this tab's edit (what "untouched by others" is measured against).
 * Resolves to
 *   { ok: true,  updatedAt, fields, merged }   — written; `fields` is what was written (merged notes included)
 *   { ok: false, conflicts, fresh, fields }    — another writer changed one of these fields; nothing written.
 */
export async function casSave({ id, fields, base, seen, update, read, appendable = ['notes'], maxTries = 4 }) {
  let want = { ...fields };
  const allMerged = new Set();
  let token = seen || null;
  for (let i = 0; i < maxTries; i++) {
    if (Object.keys(want).length === 0) return { ok: true, updatedAt: token, fields: {}, merged: [...allMerged] };
    if (token) {
      const next = await update(id, want, token);
      if (next) return { ok: true, updatedAt: next, fields: want, merged: [...allMerged] };
    }
    const fresh = await read(id, Object.keys(fields));
    if (!fresh) throw new Error('This card no longer exists');
    const plan = planMerge({ fields: want, base, fresh, appendable });
    if (plan.conflicts.length) return { ok: false, conflicts: plan.conflicts, fresh, fields: want };
    plan.merged.forEach((k) => allMerged.add(k));
    // The merged notes now contain theirs, so "theirs" is the new base for the next round.
    base = { ...base, ...Object.fromEntries(Object.keys(plan.fields).map((k) => [k, fresh[k]])) };
    want = plan.fields;
    token = fresh.updatedAt || null;
    if (!token) throw new Error('The card has no version stamp (updated_at) to save against');
  }
  throw new Error('The card kept changing while saving — try again');
}

/**
 * A realtime row for the OPEN card. Fields the user is not editing (`dirty` = pending keys) take the new value at
 * once; dirty ones are left for the save's merge. `advance` says whether this tab may adopt the row's updated_at as
 * its new "seen": only when no dirty field was changed by the other writer, or the save's compare-and-set would
 * stop detecting that change.
 */
export function liveUpdate(card, incoming, dirty = {}, base = {}) {
  const apply = {};
  let advance = true;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'updatedAt' || k === 'lastUpdated') continue;
    if (k in dirty) {
      if (!same(v, base[k]) && !same(v, dirty[k])) advance = false;
      continue;
    }
    if (!same(card[k], v)) apply[k] = v;
  }
  return { apply, advance };
}

/** Subscribe to one deal's UPDATEs (the open card). Returns a stop function. `supabase` is the shared client. */
export function watchDeal(supabase, dealId, onRow) {
  const ch = supabase.channel(`open-card-${dealId}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'deals', filter: `id=eq.${dealId}` },
      (payload) => { if (payload && payload.new) onRow(payload.new); })
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch { /* already gone */ } };
}
