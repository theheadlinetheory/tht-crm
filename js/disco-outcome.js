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

import { state } from './app.js?v=20260903134214';
import { esc, svgIcon } from './utils.js?v=20260903134214';
import { sbCreateInteraction, showToast } from './api.js?v=20260903134214';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260903134214';

// pipeline-level03 runs on the CRM's own Supabase project (moved 2026-09-03). It
// is deployed with JWT verification, so the anon key goes along as the bearer.
const PENDING_URL =
  SUPABASE_URL + '/functions/v1/pipeline-level03?action=pending';

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
export const DEMO_OUTCOMES = ['Won', 'Lost', 'Not qualified'];
export const DISCO_OUTCOMES = ['No-show', 'Demo booked', 'Not interested', 'Disqualified'];

// Written before the four-way dropdown replaced them (2026-08-28). Still read
// so entries already on a timeline keep counting.
export const HELD = 'Discovery call — held';
export const NO_SHOW = 'Discovery call — no-show';

let _pending = null;      // null = not loaded yet, [] = loaded and empty
let _loading = false;

/** Load the queue once per session; the banner re-renders when it lands. */
export function loadDiscoOutcomes(rerender) {
  if (_pending !== null || _loading) return;
  _loading = true;
  fetch(PENDING_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } })
    .then(r => r.json())
    .then(j => {
      // Only rows we can actually attach an answer to. A pending disco whose
      // lead has no CRM deal cannot be marked, and showing it would be a
      // button that does nothing.
      _pending = (j.pending || []).filter(p => p.deal_id);
      _loading = false;
      if (rerender) rerender();
    })
    .catch(e => { console.warn('[disco-outcome] load failed:', e); _pending = []; _loading = false; });
}

export function pendingDiscoCount() {
  return _pending ? _pending.length : 0;
}

export function renderDiscoOutcomeBanner() {
  if (!_pending || !_pending.length) return '';
  return `<span style="display:inline-flex;align-items:center;gap:6px">
    ${svgIcon('help-circle', 12, '#7c3aed')}
    <span style="color:#5b21b6;font-weight:600">${_pending.length} discovery call${_pending.length === 1 ? '' : 's'} need an outcome</span>
    <button onclick="openDiscoOutcomeQueue()" style="padding:2px 8px;border:1px solid #7c3aed;border-radius:5px;background:#f5f3ff;color:#7c3aed;font-size:11px;font-weight:600;cursor:pointer">Mark them</button>
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

export async function markDemo(dealId, outcome) {
  if (!outcome || !DEMO_OUTCOMES.includes(outcome)) return;
  try {
    await sbCreateInteraction({
      deal_id: dealId, type: 'Meeting',
      content: DEMO_OUTCOME_PREFIX + outcome + ' · marked in the CRM',
    });
    showToast('Marked: ' + outcome, 'success');
  } catch (e) {
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

export function openDiscoOutcomeQueue() {
  if (!_pending) return;
  const html = `<div id="disco-queue-overlay" style="position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)" onclick="if(event.target===this)closeDiscoOutcomeQueue()">
    <div style="background:#fff;border-radius:12px;width:92%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb">
        <div style="font-size:16px;font-weight:700;color:#1e1b4b">Did these discovery calls happen?</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">Booked, the time has passed, and no demo was booked afterwards. Ones that led to a demo are counted automatically.</div>
      </div>
      <div id="disco-queue-body" style="flex:1;overflow-y:auto;padding:4px 20px 12px">
        ${_pending.map(rowFor).join('')}
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
      if (!_pending.length) { closeDiscoOutcomeQueue(); showToast('All discovery calls marked', 'success'); }
    } else {
      showToast('Marked: ' + outcome, 'success');
    }
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
