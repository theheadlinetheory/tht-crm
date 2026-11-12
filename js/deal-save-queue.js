// ═══════════════════════════════════════════════════════════
// DEAL-SAVE-QUEUE — debounced deal field saves, keyed by deal id
// ═══════════════════════════════════════════════════════════
// Import-free so node can test it (scripts/test-deal-save-queue.mjs).
//
// The old debounce was one module-wide timer + a Set of dirty field NAMES, and
// the timer read the values back out of the DOM when it fired. Close the card
// inside 800ms → `if(!state.selectedDeal) return` → edit lost. Open another
// card inside 800ms → it read the NEW card's inputs. (Tim, 2026-11-12)
// Now the value is captured at edit time, per deal, and flush() starts the save
// straight away (closeDealModal / openDeal call it before the card goes).
//
// createDealSaveQueue({ save, onSaved, onFailed, delay })
//   save(dealId, fields)            → Promise; the real write
//   onSaved(dealId, fields)         → after the write lands
//   onFailed(dealId, fields, prev, err) → write failed; prev = value before the
//                                     first unsaved edit of each field (for rollback)
export function createDealSaveQueue({ save, onSaved = () => {}, onFailed = () => {}, delay = 800, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map(); // dealId → { fields:{}, prev:{}, timer }

  function queue(dealId, field, value, prevValue) {
    const id = String(dealId);
    let p = pending.get(id);
    if (!p) { p = { fields: {}, prev: {}, timer: null }; pending.set(id, p); }
    if (!(field in p.fields)) p.prev[field] = prevValue;
    p.fields[field] = value;
    clearTimer(p.timer);
    p.timer = setTimer(() => { flush(id); }, delay);
  }

  // Starts the write(s) synchronously; the returned promise settles when they do.
  // No id → every deal with unsaved edits.
  function flush(dealId) {
    const ids = dealId === undefined ? [...pending.keys()] : [String(dealId)];
    const writes = [];
    for (const id of ids) {
      const p = pending.get(id);
      if (!p) continue;
      clearTimer(p.timer);
      pending.delete(id);
      const { fields, prev } = p;
      if (Object.keys(fields).length === 0) continue;
      let w;
      try { w = Promise.resolve(save(id, fields)); }
      catch (e) { w = Promise.reject(e); }
      writes.push(w.then(() => onSaved(id, fields), (err) => onFailed(id, fields, prev, err)));
    }
    return Promise.all(writes);
  }

  function hasPending(dealId) {
    return dealId === undefined ? pending.size > 0 : pending.has(String(dealId));
  }

  return { queue, flush, hasPending };
}
