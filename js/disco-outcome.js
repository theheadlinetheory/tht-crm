// ═══════════════════════════════════════════════════════════
// DISCO OUTCOME — did the discovery call actually happen?
// ═══════════════════════════════════════════════════════════
//
// Level 03 needs to know whether a booked Google Meet discovery call was HELD.
// Nothing records it: Calendly's no_show flag is null on all 284 events and its
// meeting-notes fields are empty, so Calendly only knows "booked" and
// "cancelled". Phone discos are fine — JustCall carries a disposition.
//
// Most of it is inferred rather than asked. Lars, 2026-08-27:
//
//   "its easy for demo booked because that automatically means it happened but
//    I think that may be something we need to mark and add as a manual
//    reporting step"
//
// So a disco that produced a demo is counted as held automatically, and this
// queue only ever shows the remainder — an elapsed, non-cancelled disco with no
// demo behind it. That is what keeps it a short list instead of every call.
//
// The answer is stored as a normal CRM interaction, which means no new table and
// no schema change: the same anon insert the call touchpoints already use.

import { state } from './app.js?v=20260905075300';
import { esc, svgIcon } from './utils.js?v=20260905075300';
import { sbCreateInteraction, showToast } from './api.js?v=20260905075300';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260905075300';

// pipeline-level03 runs on the CRM's own Supabase project (moved 2026-09-03). It
// is deployed with JWT verification, so the anon key goes along as the bearer.
const PENDING_URL =
  SUPABASE_URL + '/functions/v1/pipeline-level03?action=pending';
// Level 05's queue is the superset: every due demo without a FINAL answer —
// nothing recorded, or still Qualified — Pending.
const DEMO_PENDING_URL =
  SUPABASE_URL + '/functions/v1/pipeline-level05?action=pending';

// The rep picks one of four after the meeting. Each counts differently in
// level 03, which is why a plain "did it happen?" was not enough:
//
//   No-show         never happened — the disco does not enter the level at all
//   Demo booked     happened, and it converted — denominator AND numerator
//   Not interested  happened, they declined — denominator only, a real loss
//   Disqualified    happened, WE ended it — LEAVES the denominator entirely,
//                   because a lead we rejected was never ours to convert
//                   (see counting-rules.md)
export const OUTCOME_PREFIX = 'Discovery call — ';

// Level 05, same shape. A win needs no reporting — a client row in the CRM is
// the signal — but a LOSS produces nothing anywhere, which is the asymmetry that
// made this level need archaeology. Marked here for demos Aidan runs, which
// demo_tracker structurally never sees because it is Ioannis's payout ledger.
export const DEMO_OUTCOME_PREFIX = 'Demo — ';
// Level 04 added No-show (the demo did not happen) and Not right now (it did,
// and they are a warm follow-up — moves the deal to Nurture like the Demo
// Tracker's outcome does). 2026-09-04.
// The demo dropdown speaks the Demo Tracker's language, verbatim, plus No-Show
// for attendance (Lars, 2026-09-04: "this is what gets used now"). The ledger
// writes the answer INTO the Tracker row, so the Tracker fills itself.
// "Qualified — Pending" = showed, no decision yet; the timeline keeps asking
// until a final answer lands. "Closed Lost" asks for a reason.
export const DEMO_OUTCOMES = ['No-Show', 'Qualified — Pending', 'Qualified — Closed Won', 'Qualified — Not Right Now', 'Qualified — Closed Lost', 'Not Qualified'];
export const DEMO_LOST = 'Qualified — Closed Lost';
export const DEMO_PENDING = 'Qualified — Pending';
// Why we lost — the four values Aidan used across every historical loss
// (specs/04), plus Other as a safety valve. Watch Other: if it dominates, the
// list is wrong.
export const LOST_REASONS = ['Went dark after the demo', 'Price', 'Timing', 'Not convinced it works'];
// Not right now (2026-09-04): the call happened, they are a warm follow-up —
// moves the deal to Nurture, the same click as after a demo. These two lists
// are THE options for a lost meeting: the timeline dropdown, the outcome
// queue and the removal picker all read them, so they can never diverge.
export const DISCO_OUTCOMES = ['No-show', 'Demo booked', 'Not interested', 'Disqualified', 'Not right now'];

// Written before the four-way dropdown replaced them (2026-08-28). Still read
// so entries already on a timeline keep counting.
export const HELD = 'Discovery call — held';
export const NO_SHOW = 'Discovery call — no-show';

let _pending = null;      // null = not loaded yet, [] = loaded and empty
let _pendingDemos = null; // level 04's queue: due demos with nothing recorded
let _loading = false;

/** Load the queue once per session; the banner re-renders when it lands. */
export function loadDiscoOutcomes(rerender) {
  if (_pending !== null || _loading) return;
  _loading = true;
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const get = (url) => fetch(url, { method: 'POST', headers }).then(r => r.json()).catch(e => { console.warn('[disco-outcome] load failed:', e); return {}; });
  Promise.all([get(PENDING_URL), get(DEMO_PENDING_URL)]).then(([d, m]) => {
    // Only rows we can actually attach an answer to. A pending call whose lead
    // has no CRM deal cannot be marked, and showing it would be a button that
    // does nothing.
    _pending = (d.pending || []).filter(p => p.deal_id);
    _pendingDemos = (m.pending || []).filter(p => p.deal_id);
    _loading = false;
    if (rerender) rerender();
  });
}

/** "Not right now" is a warm follow-up, not a loss: the deal goes to Nurture
 *  with a date on it — the same path the Demo Tracker's outcome takes. */
function openNurture(dealId, fromDemo) {
  closeDiscoOutcomeQueue();
  state.selectedDeal = null;
  state._nurtureEntryDealId = dealId;
  state._nurtureEntryBucket = 'not_now';
  state._nurtureEntryFromDemo = !!fromDemo;
  import('./render.js?v=20260905075300').then(m => m.render());
}

export function pendingDiscoCount() {
  return _pending ? _pending.length : 0;
}

export function pendingDemoCount() {
  return _pendingDemos ? _pendingDemos.length : 0;
}

export function renderDiscoOutcomeBanner() {
  const nd = pendingDiscoCount(), nm = pendingDemoCount();
  if (!nd && !nm) return '';
  const parts = [];
  if (nd) parts.push(`${nd} discovery call${nd === 1 ? '' : 's'}`);
  if (nm) parts.push(`${nm} demo${nm === 1 ? '' : 's'}`);
  return `<span style="display:inline-flex;align-items:center;gap:6px">
    ${svgIcon('help-circle', 12, '#7c3aed')}
    <span style="color:#5b21b6;font-weight:600">${parts.join(' and ')} need an outcome</span>
    <button onclick="openDiscoOutcomeQueue()" style="padding:2px 8px;border:1px solid #7c3aed;border-radius:5px;background:#f5f3ff;color:#7c3aed;font-size:11px;font-weight:600;cursor:pointer">Answer</button>
  </span>`;
}

function rowFor(p) {
  const deal = state.deals.find(d => d.id === p.deal_id);
  const who = deal ? (deal.company || deal.contact || p.email) : p.email;
  return `<div id="disco-row-${esc(p.deal_id)}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(who)}</div>
      <div style="font-size:11px;color:#9ca3af">${esc(p.email)}</div>
    </div>
    ${outcomeSelect(p.deal_id)}
  </div>`;
}

/** The four-way picker, shared by the queue and the deal-card timeline. */
export function demoOutcomeSelect(dealId) {
  return `<select onchange="markDemo('${esc(dealId)}',this.value);this.disabled=true"
    style="padding:4px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:11px;background:#fff;cursor:pointer">
    <option value="">What happened?</option>
    ${DEMO_OUTCOMES.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
  </select>`;
}

/** Why did we lose it? Resolves to the reason, or null if the rep cancels. */
export function askLostReason() {
  return new Promise((resolve) => {
    const div = document.createElement('div');
    div.id = 'lost-reason-picker';
    div.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:340px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">Why did we lose it?</h3>
      <div style="font-size:11px;color:#6b7280;margin-bottom:14px">One reason. Goes on the Timeline and into the Demo Tracker's notes.</div>`;
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    const done = (v) => { div.remove(); resolve(v); };
    const button = (text, style, handler) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = text;
      b.style.cssText = 'width:100%;justify-content:start;padding:10px 14px;' + style; b.onclick = handler; list.appendChild(b);
    };
    LOST_REASONS.forEach(r => button(r, 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca', () => done(r)));
    button('Other…', 'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe', () => { const r = prompt('Reason:'); if (r && r.trim()) done('Other: ' + r.trim()); });
    box.appendChild(list);
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost'; cancel.style.cssText = 'width:100%;margin-top:12px;font-size:12px'; cancel.textContent = 'Cancel';
    cancel.onclick = () => done(null);
    box.appendChild(cancel); div.appendChild(box); document.body.appendChild(div);
  });
}

/** Record a demo's outcome on the Timeline. Returns false if the rep cancelled
 *  (a lost demo needs its reason), so callers do not archive on a non-answer. */
export async function markDemo(dealId, outcome) {
  if (!outcome || !DEMO_OUTCOMES.includes(outcome)) return false;
  let value = outcome;
  if (outcome === DEMO_LOST) {
    const reason = await askLostReason();
    if (reason === null) return false;
    value = outcome + ': ' + reason;
  }
  const row = document.getElementById('demo-row-' + dealId);
  if (row) row.style.opacity = '.4';
  try {
    await sbCreateInteraction({
      deal_id: dealId, type: 'Meeting',
      content: DEMO_OUTCOME_PREFIX + value + ' · marked in the CRM',
    });
    if (_pendingDemos) {
      _pendingDemos = _pendingDemos.filter(p => p.deal_id !== dealId);
      if (row) row.remove();
      if (!_pendingDemos.length && !(_pending && _pending.length)) closeDiscoOutcomeQueue();
    }
    showToast('Marked: ' + value, 'success');
    if (outcome === 'Qualified — Not Right Now') openNurture(dealId, true);
    return true;
  } catch (e) {
    if (row) row.style.opacity = '1';
    showToast('Could not save: ' + e.message, 'error');
    throw e;
  }
}

export function outcomeSelect(dealId) {
  return `<select onchange="markDisco('${esc(dealId)}',this.value);this.disabled=true"
    style="padding:4px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:11px;background:#fff;cursor:pointer">
    <option value="">What happened?</option>
    ${DISCO_OUTCOMES.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
  </select>`;
}

function demoRowFor(p) {
  const deal = state.deals.find(d => d.id === p.deal_id);
  const who = deal ? (deal.company || deal.contact || p.email) : p.email;
  const when = p.demo_for ? String(p.demo_for).slice(0, 16).replace('T', ' ') : '';
  return `<div id="demo-row-${esc(p.deal_id)}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(who)}</div>
      <div style="font-size:11px;color:#9ca3af">${esc(p.email)}${when ? ' · demo ' + esc(when) : ''}</div>
    </div>
    ${demoOutcomeSelect(p.deal_id)}
  </div>`;
}

export function openDiscoOutcomeQueue() {
  if (!_pending && !_pendingDemos) return;
  const discos = _pending || [], demos = _pendingDemos || [];
  const section = (title, sub, rows) => rows.length ? `
      <div style="padding:12px 20px 4px">
        <div style="font-size:13px;font-weight:700;color:#1e1b4b">${title}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${sub}</div>
      </div>
      <div style="padding:0 20px 8px">${rows.join('')}</div>` : '';
  const html = `<div id="disco-queue-overlay" style="position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)" onclick="if(event.target===this)closeDiscoOutcomeQueue()">
    <div style="background:#fff;border-radius:12px;width:92%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb">
        <div style="font-size:16px;font-weight:700;color:#1e1b4b">What happened on these?</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">Only meetings whose time has passed with nothing recorded. Ones that led somewhere are counted automatically.</div>
      </div>
      <div id="disco-queue-body" style="flex:1;overflow-y:auto">
        ${section('Discovery calls', 'Booked, the time has passed, and no demo was booked afterwards.', discos.map(rowFor))}
        ${section('Demos', 'Booked, the time has passed, and no outcome is recorded anywhere.', demos.map(demoRowFor))}
      </div>
      <div style="padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end">
        <button onclick="closeDiscoOutcomeQueue()" style="padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:12px;cursor:pointer">Done</button>
      </div>
    </div>
  </div>`;
  const c = document.createElement('div');
  c.innerHTML = html;
  document.body.appendChild(c.firstElementChild);
}

export function closeDiscoOutcomeQueue() {
  const el = document.getElementById('disco-queue-overlay');
  if (el) el.remove();
}

export async function markDisco(dealId, outcome) {
  if (!outcome) return;
  // Tolerate the old boolean call sites while any remain.
  if (outcome === true) outcome = 'Demo booked';
  if (outcome === false) outcome = 'No-show';
  if (!DISCO_OUTCOMES.includes(outcome)) return;

  const row = document.getElementById('disco-row-' + dealId);
  if (row) row.style.opacity = '.4';
  try {
    await sbCreateInteraction({
      deal_id: dealId,
      type: 'Meeting',
      content: OUTCOME_PREFIX + outcome + ' · marked in the CRM',
    });
    // Callable from the deal timeline as well as the queue, where the queue may
    // never have loaded — guard rather than assume.
    if (_pending) {
      _pending = _pending.filter(p => p.deal_id !== dealId);
      if (row) row.remove();
      if (!_pending.length && !(_pendingDemos && _pendingDemos.length)) { closeDiscoOutcomeQueue(); showToast('All marked', 'success'); }
    } else {
      showToast('Marked: ' + outcome, 'success');
    }
    if (outcome === 'Not right now') openNurture(dealId, false);
  } catch (e) {
    if (row) row.style.opacity = '1';
    showToast('Could not save: ' + e.message, 'error');
    throw e;
  }
}

window.openDiscoOutcomeQueue = openDiscoOutcomeQueue;
window.closeDiscoOutcomeQueue = closeDiscoOutcomeQueue;
window.markDisco = markDisco;
window.markDemo = markDemo;
