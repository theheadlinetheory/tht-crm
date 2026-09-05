// ═══════════════════════════════════════════════════════════
// CLIENT END — when a client leaves, record when and why
// ═══════════════════════════════════════════════════════════
//
// Level 06 of the sales pipeline (onboarded → retained past 90 days) needs two
// facts nothing recorded before 2026-09-05: the last day of service and the
// reason. Only Lars can supply them — he owns the client relationships — so
// they are asked at the one moment they are known: when a client is
// deactivated, from the settings list or the client card.
//
// The reasons are Lars's own categories from the churn sheet, not a guess.
// Two of them mean the client was never really a client and leave the level;
// the rest are churn (counting-rules.md).
//
// Written to clients.ended_on / end_reason / end_notes. Reactivating clears
// them. Level 06 reads the clients table directly.

import { state } from './app.js?v=20260905075112';
import { esc, str } from './utils.js?v=20260905075112';
import { supabase, showToast } from './api.js?v=20260905075112';

// kind: 'churn' stays in the level as a loss · 'excluded' leaves it
export const END_REASONS = [
  { label: 'Results — they left',                   kind: 'churn',    hint: 'volume or quality; their decision' },
  { label: 'Results — we fired them',               kind: 'churn',    hint: 'we could not deliver volume or quality' },
  { label: "They couldn't close the leads",         kind: 'churn',    hint: 'leads came, they did not convert them' },
  { label: 'Cashflow issues on their end',          kind: 'churn' },
  { label: 'Seasonality',                           kind: 'churn' },
  { label: 'Bad fit — should not have been signed', kind: 'excluded', hint: 'we fired them; leaves the level' },
  { label: 'Never started',                         kind: 'excluded', hint: 'closed but never went live; leaves the level' },
];

const TONE = {
  churn:    'background:#fef2f2;color:#dc2626;border:1px solid #fecaca',
  excluded: 'background:#fef9c3;color:#a16207;border:1px solid #fde68a',
  other:    'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe',
};

/**
 * Ask when and why, then deactivate. onDone(fields) runs after the row is
 * written; onCancel() if the rep backs out (the client stays active).
 */
export function showClientEndPicker(clientId, { onDone, onCancel } = {}) {
  const c = state.clients.find(x => str(x.id) === str(clientId));
  if (!c) return;
  const existing = document.getElementById('client-end-picker');
  if (existing) existing.remove();
  const today = new Date().toISOString().slice(0, 10);

  const div = document.createElement('div');
  div.id = 'client-end-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:380px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">Deactivate ${esc(c.name)}</h3>
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">Feeds level 06 of the sales pipeline. Last day of service, and why.</div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Last day of service</label>
    <input type="date" id="client-end-date" value="${today}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);margin-bottom:12px">
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Notes (optional)</label>
    <input type="text" id="client-end-notes" placeholder="volume, quality, what they said…" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);margin-bottom:14px">
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Why</label>`;
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const finish = async (reason) => {
    const endedOn = (document.getElementById('client-end-date') || {}).value || today;
    const notes = str((document.getElementById('client-end-notes') || {}).value);
    div.remove();
    const fields = { status: 'inactive', ended_on: endedOn, end_reason: reason, end_notes: notes || null };
    const { error } = await supabase.from('clients').update(fields).eq('id', c.id);
    if (error) { showToast('Deactivate failed: ' + error.message, 'error'); if (onCancel) onCancel(); return; }
    c.status = 'inactive'; c.endedOn = endedOn; c.endReason = reason; c.endNotes = notes;
    showToast(`${c.name} deactivated — ${reason}`, 'success');
    if (onDone) onDone(fields);
  };
  const button = (text, tone, handler, hint) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = 'width:100%;justify-content:start;padding:10px 14px;flex-direction:column;align-items:flex-start;gap:2px;' + TONE[tone];
    const main = document.createElement('span'); main.textContent = text; b.appendChild(main);
    if (hint) { const h = document.createElement('span'); h.style.cssText = 'font-size:10px;font-weight:400;opacity:.8;text-align:left'; h.textContent = hint; b.appendChild(h); }
    b.onclick = handler;
    list.appendChild(b);
  };
  END_REASONS.forEach(r => button(r.label, r.kind, () => finish(r.label), r.hint));
  button('Other…', 'other', () => { const r = prompt('Reason:'); if (r && r.trim()) finish('Other: ' + r.trim()); });

  box.appendChild(list);
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.style.cssText = 'width:100%;margin-top:12px;font-size:12px';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { div.remove(); if (onCancel) onCancel(); };
  box.appendChild(cancel);
  div.appendChild(box);
  document.body.appendChild(div);
}

/** Reactivating a client clears its end — it is a client again. */
export async function clearClientEnd(clientId) {
  const { error } = await supabase.from('clients').update({ ended_on: null, end_reason: null, end_notes: null }).eq('id', clientId);
  if (error) console.warn('[client-end] clear failed', error.message);
}
