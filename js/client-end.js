// ═══════════════════════════════════════════════════════════
// CLIENT END — when a client leaves, record when, who ended it, and why
// ═══════════════════════════════════════════════════════════
//
// Level 06 of the sales pipeline (onboarded → retained past 90 days) needs
// facts nothing recorded before 2026-09-05: the last day of service, who ended
// it, and why. Only Lars can supply them — he owns the client relationships —
// so they are asked at the one moment they are known: the red Offboard button
// at the bottom of the client's panel in Settings.
//
// Shape settled by Lars 2026-09-05 from his churn sheet:
//   Ended by   They left · We dropped them            (one)
//   Reasons    Lead volume · Lead quality · They couldn't close the leads ·
//              Cashflow on their end · Seasonality · Other   (one or more)
//   Notes      free text
// Whether an end counts as churn is his call later, from this data — the
// picker records facts, it does not decide.
//
// Written to clients.ended_on / ended_by / end_reason (comma-joined) /
// end_notes. Reactivating clears them. Level 06 reads the clients table.

import { state } from './app.js?v=20260907024838';
import { esc, str } from './utils.js?v=20260907024838';
import { supabase, showToast } from './api.js?v=20260907024838';

export const ENDED_BY = ['They left', 'We dropped them'];
export const END_REASONS = ['Lead volume', 'Lead quality', "They couldn't close the leads", 'Cashflow on their end', 'Seasonality', 'Other'];

const BTN = 'padding:8px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--card);color:#374151';
const ON  = 'border-color:#dc2626;background:#fef2f2;color:#dc2626';

/**
 * Ask when, who ended it, and why, then deactivate. onDone(fields) runs after
 * the row is written; onCancel() if the rep backs out (the client stays active).
 */
export function showClientEndPicker(clientId, { onDone, onCancel } = {}) {
  const c = state.clients.find(x => str(x.id) === str(clientId));
  if (!c) return;
  const existing = document.getElementById('client-end-picker');
  if (existing) existing.remove();
  const today = new Date().toISOString().slice(0, 10);
  let endedBy = null;
  const reasons = new Set();

  const div = document.createElement('div');
  div.id = 'client-end-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:400px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">Offboard ${esc(c.name)}</h3>
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">They move to Past Clients. Feeds level 06 of the sales pipeline.</div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Last day of service</label>
    <input type="date" id="client-end-date" value="${today}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);margin-bottom:12px">
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Ended by</label>
    <div id="client-end-by" style="display:flex;gap:8px;margin-bottom:12px"></div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Why <span style="font-weight:400;color:#9ca3af">— pick all that apply</span></label>
    <div id="client-end-reasons" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px"></div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Notes</label>
    <textarea id="client-end-notes" rows="3" placeholder="What they said, what happened…" style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);resize:vertical;margin-bottom:14px"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="client-end-cancel" class="btn btn-ghost" style="font-size:12px">Cancel</button>
      <button id="client-end-save" class="btn" disabled style="padding:8px 16px;background:#dc2626;color:#fff;border:1px solid #dc2626;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;opacity:.5">Offboard</button>
    </div>`;
  div.appendChild(box);
  document.body.appendChild(div);

  const byWrap = box.querySelector('#client-end-by');
  const reasonWrap = box.querySelector('#client-end-reasons');
  const save = box.querySelector('#client-end-save');
  const refresh = () => {
    byWrap.querySelectorAll('button').forEach(b => { b.style.cssText = BTN + (b.dataset.v === endedBy ? ';' + ON : ''); });
    reasonWrap.querySelectorAll('button').forEach(b => { b.style.cssText = BTN + (reasons.has(b.dataset.v) ? ';' + ON : ''); });
    const ok = !!endedBy && reasons.size > 0;
    save.disabled = !ok; save.style.opacity = ok ? '1' : '.5';
  };
  ENDED_BY.forEach(v => { const b = document.createElement('button'); b.dataset.v = v; b.textContent = v; b.style.cssText = BTN + ';flex:1'; b.onclick = () => { endedBy = v; refresh(); }; byWrap.appendChild(b); });
  END_REASONS.forEach(v => { const b = document.createElement('button'); b.dataset.v = v; b.textContent = v; b.style.cssText = BTN; b.onclick = () => { reasons.has(v) ? reasons.delete(v) : reasons.add(v); refresh(); }; reasonWrap.appendChild(b); });
  box.querySelector('#client-end-cancel').onclick = () => { div.remove(); if (onCancel) onCancel(); };
  save.onclick = async () => {
    if (!endedBy || !reasons.size) return;
    const endedOn = (box.querySelector('#client-end-date') || {}).value || today;
    const notes = str((box.querySelector('#client-end-notes') || {}).value);
    const reasonList = END_REASONS.filter(r => reasons.has(r)).join(', ');
    div.remove();
    const fields = { status: 'inactive', ended_on: endedOn, ended_by: endedBy, end_reason: reasonList, end_notes: notes || null };
    const { error } = await supabase.from('clients').update(fields).eq('id', c.id);
    if (error) { showToast('Offboard failed: ' + error.message, 'error'); if (onCancel) onCancel(); return; }
    c.status = 'inactive'; c.endedOn = endedOn; c.endedBy = endedBy; c.endReason = reasonList; c.endNotes = notes;
    showToast(`${c.name} offboarded — ${endedBy}: ${reasonList}`, 'success');
    if (onDone) onDone(fields);
  };
  refresh();
}

/** Reactivating a client clears its end — it is a client again. */
export async function clearClientEnd(clientId) {
  const { error } = await supabase.from('clients').update({ ended_on: null, ended_by: null, end_reason: null, end_notes: null }).eq('id', clientId);
  if (error) console.warn('[client-end] clear failed', error.message);
}
