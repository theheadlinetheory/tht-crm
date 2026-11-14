// ═══════════════════════════════════════════════════════════
// EMAIL TEMPLATE PICK — which Day 1 email went to an acquisition lead
// ═══════════════════════════════════════════════════════════
//
// Ioannis (2026-11-04): HVAC leads reply positive, get the service breakdown
// email, then go silent. Nothing recorded which template the Day 1 manual email
// used, so no email could be blamed. Ticking that task done now asks once and
// writes a Timeline Note "Day 1 email: <template> · marked in the CRM".
// Skipping is fine: the task is already marked done and nothing else waits on this.

import { esc } from './utils.js?v=20261114162507';
import { sbCreateInteraction, showToast } from './api.js?v=20261114162507';

export const DAY1_EMAIL_PREFIX = 'Day 1 email: ';
export const EMAIL_TEMPLATES = ['Service breakdown', 'Mechanism / Info', 'Meeting', 'Price', 'Custom'];
const DAY1_TASK = /^Manual email — SmartLead template/;

/** True for the SOP's Day 1 manual-email task. */
export const isDay1EmailTask = (act) => DAY1_TASK.test(String(act && act.subject || ''));

async function recordTemplate(dealId, template) {
  try {
    await sbCreateInteraction({ deal_id: dealId, type: 'Note', content: DAY1_EMAIL_PREFIX + template + ' · marked in the CRM' });
    showToast('Saved: ' + template, 'success');
  } catch (e) {
    console.warn('[email-template-pick] not saved for', dealId, e && e.message);
    showToast('Could not save the email template: ' + (e && e.message || e), 'error');
  }
}

/** Ask which template the Day 1 email used. Fire-and-forget from toggleActivity. */
export function askEmailTemplate(dealId) {
  document.getElementById('email-template-picker')?.remove();
  const div = document.createElement('div');
  div.id = 'email-template-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  div.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:340px;box-shadow:0 8px 30px rgba(0,0,0,.2)">
    <h3 style="margin:0 0 4px;font-size:16px">Which email did you send?</h3>
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">So we can see which email gets replies and which goes quiet.</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${EMAIL_TEMPLATES.map(t => `<button class="btn" data-template="${esc(t)}" style="width:100%;justify-content:start;padding:10px 14px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe">${esc(t)}</button>`).join('')}
    </div>
    <button class="btn btn-ghost" data-skip style="width:100%;margin-top:12px;font-size:12px">Skip</button>
  </div>`;
  div.querySelectorAll('[data-template]').forEach(b => { b.onclick = () => { div.remove(); recordTemplate(dealId, b.dataset.template); }; });
  div.querySelector('[data-skip]').onclick = () => div.remove();
  document.body.appendChild(div);
}
