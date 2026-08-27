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

import { state } from './app.js?v=20260827230505';
import { esc, svgIcon } from './utils.js?v=20260827230505';
import { sbCreateInteraction, showToast } from './api.js?v=20260827230505';

const PENDING_URL =
  'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/pipeline-level03?action=pending';

export const HELD = 'Discovery call — held';
export const NO_SHOW = 'Discovery call — no-show';

let _pending = null;      // null = not loaded yet, [] = loaded and empty
let _loading = false;

/** Load the queue once per session; the banner re-renders when it lands. */
export function loadDiscoOutcomes(rerender) {
  if (_pending !== null || _loading) return;
  _loading = true;
  fetch(PENDING_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
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
    <button onclick="markDisco('${esc(p.deal_id)}',true)" style="padding:4px 10px;border:none;border-radius:5px;background:#059669;color:#fff;font-size:11px;font-weight:600;cursor:pointer">Held</button>
    <button onclick="markDisco('${esc(p.deal_id)}',false)" style="padding:4px 10px;border:none;border-radius:5px;background:#6b7280;color:#fff;font-size:11px;font-weight:600;cursor:pointer">No-show</button>
  </div>`;
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

export async function markDisco(dealId, held) {
  const row = document.getElementById('disco-row-' + dealId);
  if (row) row.style.opacity = '.4';
  try {
    await sbCreateInteraction({
      deal_id: dealId,
      type: 'Meeting',
      content: (held ? HELD : NO_SHOW) + ' · marked in the CRM',
    });
    _pending = _pending.filter(p => p.deal_id !== dealId);
    if (row) row.remove();
    if (!_pending.length) { closeDiscoOutcomeQueue(); showToast('All discovery calls marked', 'success'); }
  } catch (e) {
    if (row) row.style.opacity = '1';
    showToast('Could not save: ' + e.message, 'error');
  }
}

window.openDiscoOutcomeQueue = openDiscoOutcomeQueue;
window.closeDiscoOutcomeQueue = closeDiscoOutcomeQueue;
window.markDisco = markDisco;
