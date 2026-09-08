#!/usr/bin/env node
// Unit tests for js/render-preserve.js — the capture/restore pair that keeps a
// full-page `app.innerHTML = ...` re-render from stealing what the user is
// typing. Import-free like the other tested modules, and it takes `doc` as a
// parameter so node can drive it with a stub.
// Run: node scripts/test-render-preserve.mjs
import assert from 'node:assert/strict';
import { isTextEntry, capturePreserve, restorePreserve } from '../js/render-preserve.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── Stub DOM ──────────────────────────────────────────────
function el(opts) {
  const e = {
    id: opts.id || '',
    tagName: opts.tagName || 'INPUT',
    type: opts.type || 'text',
    value: opts.value || '',
    isContentEditable: !!opts.isContentEditable,
    focusCalls: [],
    // Chrome throws InvalidStateError when you touch selectionStart on a
    // date/number/email input — the real reason the follow-up date field
    // needs guarding.
    _selectionThrows: !!opts.selectionThrows,
    focus(o) { this.focusCalls.push(o); this._doc.activeElement = this; },
    setSelectionRange(s, en) {
      if (this._selectionThrows) throw new Error('InvalidStateError');
      this._start = s; this._end = en;
    },
  };
  Object.defineProperty(e, 'selectionStart', {
    get() { if (this._selectionThrows) throw new Error('InvalidStateError'); return this._start ?? this.value.length; },
    configurable: true,
  });
  Object.defineProperty(e, 'selectionEnd', {
    get() { if (this._selectionThrows) throw new Error('InvalidStateError'); return this._end ?? this.value.length; },
    configurable: true,
  });
  return e;
}
function doc(els, active) {
  const d = {
    activeElement: active || null,
    scrolled: null,
    getElementById(id) { return els.find(x => x.id === id) || null; },
    defaultView: { scrollX: 0, scrollY: 0, scrollTo(x, y) { d.scrolled = [x, y]; } },
  };
  els.forEach(x => { x._doc = d; });
  return d;
}

// ── isTextEntry ───────────────────────────────────────────
test('text input is a text-entry field', () => {
  assert.equal(isTextEntry(el({ type: 'text' })), true);
});
test('date input is a text-entry field (Follow-up Date)', () => {
  assert.equal(isTextEntry(el({ type: 'date' })), true);
});
test('textarea is a text-entry field', () => {
  assert.equal(isTextEntry(el({ tagName: 'TEXTAREA', type: undefined })), true);
});
test('contenteditable is a text-entry field', () => {
  assert.equal(isTextEntry(el({ tagName: 'DIV', isContentEditable: true })), true);
});
test('checkbox is NOT a text-entry field', () => {
  assert.equal(isTextEntry(el({ type: 'checkbox' })), false);
});
test('select is NOT a text-entry field (change handlers re-render on purpose)', () => {
  assert.equal(isTextEntry(el({ tagName: 'SELECT', type: undefined })), false);
});
test('button is NOT a text-entry field', () => {
  assert.equal(isTextEntry(el({ tagName: 'BUTTON', type: undefined })), false);
});
test('null is NOT a text-entry field', () => {
  assert.equal(isTextEntry(null), false);
});

// ── capturePreserve ───────────────────────────────────────
test('captures id, value and caret of the focused note field', () => {
  const note = el({ id: 'nurture-note', value: 'Time waster' });
  note._start = 4; note._end = 4;
  const snap = capturePreserve(doc([note], note));
  assert.equal(snap.id, 'nurture-note');
  assert.equal(snap.value, 'Time waster');
  assert.equal(snap.start, 4);
  assert.equal(snap.end, 4);
});
test('captures nothing when focus is on a button', () => {
  const btn = el({ id: 'go', tagName: 'BUTTON', type: undefined });
  assert.equal(capturePreserve(doc([btn], btn)).id, null);
});
test('captures a date field whose selection API throws, without blowing up', () => {
  const date = el({ id: 'nurture-follow-up-date', type: 'date', value: '2026-05-07', selectionThrows: true });
  const snap = capturePreserve(doc([date], date));
  assert.equal(snap.id, 'nurture-follow-up-date');
  assert.equal(snap.value, '2026-05-07');
  assert.equal(snap.start, null);
});
test('captures window scroll so the page cannot jump', () => {
  const d = doc([], null);
  d.defaultView.scrollX = 12; d.defaultView.scrollY = 340;
  const snap = capturePreserve(d);
  assert.equal(snap.scrollX, 12);
  assert.equal(snap.scrollY, 340);
});

// ── restorePreserve ───────────────────────────────────────
test('re-focuses the rebuilt field WITHOUT scrolling it into view', () => {
  const before = el({ id: 'nurture-note', value: 'Time waster' });
  before._start = 4; before._end = 4;
  const snap = capturePreserve(doc([before], before));
  // Re-render: a brand-new element with the same id replaces the old one.
  const after = el({ id: 'nurture-note', value: 'Time waster' });
  const d2 = doc([after], null);
  restorePreserve(d2, snap);
  assert.equal(d2.activeElement, after, 'focus not restored');
  assert.deepEqual(after.focusCalls, [{ preventScroll: true }], 'focus() must not scroll the page');
  assert.equal(after._start, 4);
  assert.equal(after._end, 4);
});
test('restores the typed value the re-render threw away', () => {
  const before = el({ id: 'nurture-note', value: 'Time waster' });
  const snap = capturePreserve(doc([before], before));
  // renderNurtureEntryModal() rebuilds the note field empty.
  const after = el({ id: 'nurture-note', value: '' });
  const d2 = doc([after], null);
  restorePreserve(d2, snap);
  assert.equal(after.value, 'Time waster', 'typed note was lost by the re-render');
});
test('restores a picked follow-up date the re-render reset to the +90d default', () => {
  const before = el({ id: 'nurture-follow-up-date', type: 'date', value: '2026-05-07', selectionThrows: true });
  const snap = capturePreserve(doc([before], before));
  const after = el({ id: 'nurture-follow-up-date', type: 'date', value: '2026-12-07', selectionThrows: true });
  const d2 = doc([after], null);
  restorePreserve(d2, snap);
  assert.equal(after.value, '2026-05-07', 'picked date reverted to the default');
  assert.deepEqual(after.focusCalls, [{ preventScroll: true }]);
});
test('restores window scroll', () => {
  const d = doc([], null);
  d.defaultView.scrollX = 12; d.defaultView.scrollY = 340;
  const snap = capturePreserve(d);
  d.defaultView.scrollY = 0; // innerHTML swap collapsed the page
  restorePreserve(d, snap);
  assert.deepEqual(d.scrolled, [12, 340]);
});
test('no-ops when the field is gone after the re-render (modal closed)', () => {
  const before = el({ id: 'nurture-note', value: 'Time waster' });
  const snap = capturePreserve(doc([before], before));
  const d2 = doc([], null);
  assert.doesNotThrow(() => restorePreserve(d2, snap));
  assert.equal(d2.activeElement, null);
});
test('no-ops on a null snapshot', () => {
  assert.doesNotThrow(() => restorePreserve(doc([], null), null));
});

console.log(`\n${passed} passed`);
