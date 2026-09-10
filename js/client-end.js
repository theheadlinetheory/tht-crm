// ═══════════════════════════════════════════════════════════
// CLIENT END — when a client leaves, record when, who ended it, and why
// ═══════════════════════════════════════════════════════════
//
// Level 07 of the sales pipeline (onboarded → retained past 90 days) needs
// facts nothing recorded before 2026-09-05: the last day of service, who ended
// it, and why. Only Lars can supply them, so they are asked at the one moment
// they are known: when a client is offboarded, from the settings list or the
// client card.
//
// The picker's shape is Lars's (2026-09-05, FINAL): last day · Ended by (They
// left / We dropped them) · reasons, pick every one that applies · notes. No
// "Never started" or "Bad fit" — "we aren't deciding if they should count as
// churn, that's for me to decide". Level 07's rule: They left = churn and stays
// in; We dropped them = not churn, leaves the level. A teammate's rewrite of
// this file on 2026-09-08 had put the old single-choice list back and dropped
// ended_by; restored 2026-09-09.
//
// The picker collects the facts; the offboarding flow (client-offboard.js)
// writes clients.ended_on / ended_by / end_reason / end_notes at its "Mark
// inactive" step and then takes the client out of the CRM, Drive and
// Smartlead. Reactivating clears the four fields. Level 07 reads the clients
// table directly, hourly.

import { state } from './app.js?v=20260910153952';
import { esc, str } from './utils.js?v=20260910153952';
import { supabase } from './api.js?v=20260910153952';

export const ENDED_BY = ['They left', 'We dropped them'];
export const END_REASONS = ['Lead volume', 'Lead quality', "They couldn't close the leads", 'Cashflow on their end', 'Seasonality', 'Other'];

const INPUT = 'width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)';

/**
 * Ask when, who ended it, and why, then hand off to the offboarding flow.
 * onDone(fields) runs after the flow has written the row; onCancel() if the
 * rep backs out (the client stays active).
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
  box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:400px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">Offboard ${esc(c.name)}</h3>
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">They move to Past Clients. Feeds level 07 of the sales pipeline: last day of service, and why.</div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Last day of service</label>
    <input type="date" id="client-end-date" value="${today}" style="${INPUT};margin-bottom:12px">
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Ended by</label>
    <div id="client-end-by" style="display:flex;gap:8px;margin-bottom:12px">
      ${ENDED_BY.map(v => `<button type="button" class="btn" data-v="${esc(v)}" style="flex:1;justify-content:center;padding:8px 10px;border:1px solid var(--border);background:var(--card);font-size:12px">${esc(v)}</button>`).join('')}
    </div>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Why <span style="font-weight:400;color:#9ca3af">— pick every one that applies</span></label>
    <div id="client-end-reasons" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px">
      ${END_REASONS.map(r => `<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" value="${esc(r)}"> ${esc(r)}</label>`).join('')}
    </div>
    <input type="text" id="client-end-other" placeholder="Other — what happened" style="${INPUT};margin-bottom:12px" hidden>
    <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Notes (optional)</label>
    <input type="text" id="client-end-notes" placeholder="what they said, what we saw…" style="${INPUT};margin-bottom:14px">
    <div id="client-end-error" style="font-size:11px;color:#b91c1c;margin-bottom:8px" hidden></div>
    <button type="button" id="client-end-go" class="btn" style="width:100%;justify-content:center;padding:10px 14px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-weight:600">Offboard client</button>
    <button type="button" id="client-end-cancel" class="btn btn-ghost" style="width:100%;margin-top:8px;font-size:12px">Cancel</button>`;
  div.appendChild(box);
  document.body.appendChild(div);

  let endedBy = null;
  const byButtons = [...box.querySelectorAll('#client-end-by button')];
  byButtons.forEach(b => b.onclick = () => {
    endedBy = b.dataset.v;
    byButtons.forEach(x => { const on = x === b; x.style.background = on ? '#1e1b4b' : 'var(--card)'; x.style.color = on ? '#fff' : ''; x.style.borderColor = on ? '#1e1b4b' : 'var(--border)'; });
  });
  const otherBox = box.querySelector('input[value="Other"]');
  const otherText = box.querySelector('#client-end-other');
  otherBox.onchange = () => { otherText.hidden = !otherBox.checked; if (otherBox.checked) otherText.focus(); };

  const fail = (msg) => { const e = box.querySelector('#client-end-error'); e.textContent = msg; e.hidden = false; };
  box.querySelector('#client-end-go').onclick = async () => {
    const endedOn = box.querySelector('#client-end-date').value || today;
    const picked = [...box.querySelectorAll('#client-end-reasons input:checked')].map(i => i.value);
    const other = str(otherText.value);
    if (!endedBy) return fail('Pick who ended it.');
    if (!picked.length) return fail('Pick at least one reason.');
    const reasons = picked.map(r => r === 'Other' ? (other ? 'Other: ' + other : 'Other') : r);
    const notes = str(box.querySelector('#client-end-notes').value);
    div.remove();
    // The offboarding flow writes the row at its "Mark inactive" step (ended_on / ended_by / end_reason / end_notes), then
    // takes the client out of the CRM, Drive and Smartlead — so nothing is saved twice.
    const { openOffboard } = await import('./client-offboard.js?v=20260910153952');
    await openOffboard(c.id, { reason: reasons.join(', '), endedBy, notes, endedOn, category: endedBy === 'We dropped them' ? 'excluded' : 'churn' });
    if (onDone) onDone({ status: 'inactive', ended_on: endedOn, ended_by: endedBy, end_reason: reasons.join(', '), end_notes: notes || null });
  };
  box.querySelector('#client-end-cancel').onclick = () => { div.remove(); if (onCancel) onCancel(); };
}

/** Reactivating a client clears its end — it is a client again. */
export async function clearClientEnd(clientId) {
  const { error } = await supabase.from('clients').update({ ended_on: null, ended_by: null, end_reason: null, end_notes: null }).eq('id', clientId);
  if (error) console.warn('[client-end] clear failed', error.message);
}
