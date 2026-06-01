// ═══════════════════════════════════════════════════════════
// DELEGATE — Centralized event delegation
// ═══════════════════════════════════════════════════════════
//
// Replaces inline onclick/onchange/oninput handlers with
// data-action attributes. Handlers register via registerActions().
// A single listener on document.body delegates to the right handler.
//
// Usage in HTML:  <button data-action="openDeal" data-id="123">
// Usage in JS:    registerActions({ openDeal(el) { ... } });

const _actions = {};

export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    _actions[name] = fn;
  }
}

function getActionEl(target) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset && el.dataset.action) return el;
    el = el.parentElement;
  }
  return null;
}

function handleEvent(e) {
  const el = getActionEl(e.target);
  if (!el) return;
  // Skip click events on select/input — they should only fire on change/input
  const tag = el.tagName;
  if (e.type === 'click' && (tag === 'SELECT' || tag === 'INPUT')) return;
  const action = el.dataset.action;
  const fn = _actions[action];
  if (!fn) return;
  fn(el, e);
}

// Modal backdrop click: tracks mousedown target to prevent
// closing when drag-selecting text inside the modal.
let _mdownTarget = null;

function handleMousedown(e) {
  const el = getActionEl(e.target);
  if (el && el.dataset.action === 'dismissOverlay') {
    _mdownTarget = e.target;
  }
}

function handleBackdropClick(e) {
  const el = getActionEl(e.target);
  if (el && el.dataset.action === 'dismissOverlay' && e.target === el && _mdownTarget === el) {
    const fn = _actions['dismissOverlay'];
    if (fn) fn(el, e);
  }
  _mdownTarget = null;
}

export function initDelegation() {
  document.body.addEventListener('click', handleEvent);
  document.body.addEventListener('change', handleEvent);
  document.body.addEventListener('input', handleEvent);
  // Backdrop dismiss uses mousedown+click combo
  document.body.addEventListener('mousedown', handleMousedown);
  document.body.addEventListener('click', handleBackdropClick);
}
