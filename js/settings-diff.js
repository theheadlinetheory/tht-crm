// ═══════════════════════════════════════════════════════════
// SETTINGS-DIFF — send only what this person changed in Settings
// ═══════════════════════════════════════════════════════════
// Import-free so node can test it (scripts/test-settings-diff.mjs).
//
// Settings autosave used to write ~45 columns on EVERY client row (and every
// crm_settings key) on each keystroke, so whoever saved last silently put back
// the old values of everything another admin had just changed. (Tim, 2026-11-12)
// Now: snapshot what was loaded, and send only the rows/fields that differ.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// rows: [{id, ...fields}] → Map id → fields copy. Existing entries are kept
// unless `overwrite`, so a late-arriving row can be added without resetting edits.
export function snapshotRows(rows, snap = new Map(), overwrite = true) {
  for (const r of rows) {
    const id = String(r.id);
    if (!overwrite && snap.has(id)) continue;
    snap.set(id, clone(r));
  }
  return snap;
}

// → [{id, ...changedFieldsOnly}]; rows with no snapshot are skipped (nothing
// known to have changed) — call snapshotRows(..., false) before editing them.
export function diffRows(rows, snap) {
  const out = [];
  for (const r of rows) {
    const base = snap.get(String(r.id));
    if (!base) continue;
    const changed = {};
    for (const k of Object.keys(r)) {
      if (k === 'id') continue;
      if (!same(r[k], base[k])) changed[k] = r[k];
    }
    if (Object.keys(changed).length) out.push({ id: r.id, ...changed });
  }
  return out;
}

// After a successful save, fold what was sent into the snapshot.
export function commitRows(sent, snap) {
  for (const { id, ...fields } of sent) {
    const base = snap.get(String(id)) || {};
    for (const k of Object.keys(fields)) base[k] = clone(fields[k]);
    snap.set(String(id), base);
  }
}

// Key/value settings (crm_settings rows): only the keys whose value changed.
export function snapshotSettings(obj) { return clone(obj || {}); }
export function diffSettings(obj, snap) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (!same(obj[k], snap?.[k])) out[k] = obj[k];
  return out;
}
export function commitSettings(sent, snap) {
  for (const k of Object.keys(sent)) snap[k] = clone(sent[k]);
}
