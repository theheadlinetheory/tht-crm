// ═══════════════════════════════════════════════════════════
// RENDER-PRESERVE — keep the user's edit alive across a re-render
// ═══════════════════════════════════════════════════════════
//
// render() rebuilds the whole page with `app.innerHTML = html`. Supabase
// realtime, the 2-minute background sync and the visibilitychange re-sync all
// fire it, so it lands mid-keystroke: every form field in #app is destroyed and
// rebuilt from its default markup. The user sees their note vanish, a picked
// date snap back to the +90d default, and the page jump because the old
// re-focus hack called focus() (which scrolls the field into view).
//
// capturePreserve() snapshots what the user is editing; restorePreserve() puts
// it back. render() calls them around the swap SYNCHRONOUSLY — no rAF, no
// setTimeout — so no keystroke can land in the gap and be dropped.
//
// `doc` is a parameter rather than the global so this stays testable in node.
// See scripts/test-render-preserve.mjs.

// Everything the user types into. SELECT is deliberately absent: its change
// handlers re-render on purpose and must not be fought.
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'tel', 'url', 'number', 'password',
  'date', 'time', 'datetime-local', 'month', 'week',
]);

export function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase());
}

// Chrome throws InvalidStateError on selectionStart/selectionEnd for date,
// number and email inputs — reading the caret must never break a render.
function caretOf(el) {
  try { return { start: el.selectionStart, end: el.selectionEnd }; }
  catch { return { start: null, end: null }; }
}

export function capturePreserve(doc) {
  const view = doc.defaultView || {};
  const snap = { id: null, value: null, start: null, end: null, scrollX: view.scrollX || 0, scrollY: view.scrollY || 0 };
  const el = doc.activeElement;
  // Only fields carrying an id survive the swap — that's what we re-find by.
  if (!isTextEntry(el) || !el.id) return snap;
  const caret = caretOf(el);
  snap.id = el.id;
  snap.value = el.value;
  snap.start = caret.start;
  snap.end = caret.end;
  return snap;
}

export function restorePreserve(doc, snap) {
  if (!snap) return;
  const view = doc.defaultView;
  if (view && typeof view.scrollTo === 'function' && (view.scrollX !== snap.scrollX || view.scrollY !== snap.scrollY)) {
    view.scrollTo(snap.scrollX, snap.scrollY);
  }
  if (!snap.id) return;
  const el = doc.getElementById(snap.id);
  if (!el) return; // field is gone — modal closed, view switched
  if (snap.value !== null && el.value !== snap.value) el.value = snap.value;
  // Caret BEFORE focus(): focus() fires the field's onfocus synchronously, and
  // the global search input's onfocus re-renders. Set the caret first so a
  // nested capture reads the real position — set after, it lands on an element
  // the nested render already destroyed and the caret stays at 0, which made
  // typed searches come out backwards.
  if (snap.start !== null) {
    try { el.setSelectionRange(snap.start, snap.end); } catch { /* type has no caret */ }
  }
  el.focus({ preventScroll: true });
}
