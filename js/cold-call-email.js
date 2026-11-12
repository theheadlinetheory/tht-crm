// ═══════════════════════════════════════════════════════════
// COLD-CALL EMAIL — first email to a lead booked on a cold call
// ═══════════════════════════════════════════════════════════
// A cold-call lead has no email thread yet, so this starts one: from the
// client's designated inbox (clients.cold_call_email), to the lead, with the
// client CC'd. Ioannis's format (call with Tim, 2026-11-06): subject
// "<First> - Appointment Confirmation", body from the pass-off panel's lead box.
//
// Main button: "Create draft in contact@…" — gmail-lead-draft saves it in that
// inbox's Drafts folder (Tim, 2026-11-07: a real draft, ready to send). The
// first time for an inbox it opens Google's consent page instead (gmail-connect).
// Fallback link: the old Gmail compose window, filled in, for an inbox that is
// not connected yet.

import { esc, str, applyTemplate, svgIcon } from './utils.js?v=20261113002412';
import { state } from './app.js?v=20261113002412';
import { invokeEdgeFunction, sbUpdateDeal, showToast } from './api.js?v=20261113002412';
import { passoffInFlight, buttonState, onScreenText } from './passoff-core.js?v=20261113002412';

const SUBJECT = '{FIRST_NAME} - Appointment Confirmation';
// Client SDR Templates SOP, Template 2. Used only when Claude has not drafted the lead box yet.
const BODY = `Hi {FIRST_NAME}. Great chatting with you just now.

I'll add {OWNER}, the owner, to this thread. We will stop by on {MEETING_TIME} and put together an estimate.
{PHONE_LINE}
Looking forward to it.

Best regards,
[YOUR NAME]
{CLIENT}`;

/** "Woody's Landcare LLC" -> "Woody's Landcare"; the legal suffix reads oddly to a lead. */
export function clientDisplayName(name) {
  return str(name).replace(/[\s,]+(LLC|L\.L\.C\.|Ltd\.?|Inc\.?|Corp\.?)$/i, '').trim();
}

function fill(text, deal, client) {
  const field = key => applyTemplate(key, deal, '', '');
  const meeting = field('{MEETING_TIME}');
  const owner = str(client.contactFirstName).trim() || clientDisplayName(client.name);
  const phone = str(client.clientPhone || client.notifyPhone).trim();
  return text
    .replaceAll('{CLIENT}', clientDisplayName(client.name))
    .replaceAll('{OWNER}', owner)
    .replaceAll('{FIRST_NAME}', field('{FIRST_NAME}') || 'there')
    .replace('{MEETING_TIME}', meeting || '[DAY] at [TIME]')
    .replace('{PHONE_LINE}', phone ? `\n${owner}'s phone number is ${phone}, feel free to reach out to ${owner} if you have any questions or if something comes up before we meet.\n` : '');
}

function leadBody(deal, client) {
  // Claude's draft from the pass-off panel (edited by the caller) wins over the fixed template.
  return str(deal.passoffLeadMessage).trim() || fill(BODY, deal, client);
}

function canEmail(deal, client) {
  return !!(str(client && client.coldCallEmail).trim() && str(deal && deal.email).trim() && str(deal.leadSource) === 'cold_call');
}

/** Gmail compose URL in the client's cold-call inbox, or null when it can't be sent. */
export function coldCallEmailUrl(deal, client) {
  if (!canEmail(deal, client)) return null;
  const params = new URLSearchParams({
    authuser: str(client.coldCallEmail).trim(),
    view: 'cm',
    fs: '1',
    to: str(deal.email).trim(),
    cc: str(client.notifyEmails).trim(),
    su: fill(SUBJECT, deal, client),
    body: leadBody(deal, client),
  });
  return `https://mail.google.com/mail/u/0/?${params}`;
}

async function createLeadDraft(dealId, clientName) {
  const deal = state.selectedDeal && String(state.selectedDeal.id) === String(dealId)
    ? state.selectedDeal : state.deals.find(d => String(d.id) === String(dealId));
  if (!deal) return;
  // Ignored while this deal's draft is saving or Claude is rewriting the lead box (Tim, 2026-11-12).
  if (!passoffInFlight.begin(dealId, 'gmail-draft')) return;
  const btn = document.getElementById('cc-draft-btn');
  let tab = null;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving draft…'; }
  try {
    // The draft is built from what is SAVED on the card, so save the lead box now (its own save is
    // debounced). What is on screen wins over the deal copy, which can lag the box.
    const leadBox = document.getElementById('passoff-lead-text');
    const text = onScreenText(leadBox ? leadBox.value : '', deal.passoffLeadMessage);
    if (!str(text).trim()) throw new Error('Draft the lead confirmation in the pass-off panel first.');
    // Open the tab inside the click so the popup blocker allows it; it is pointed at Gmail once we know where.
    tab = window.open('about:blank', '_blank');
    await sbUpdateDeal(dealId, { passoff_lead_message: text });
    const resp = await invokeEdgeFunction('gmail-lead-draft', { dealId, clientName });
    if (resp.needsConnect) {
      const c = await invokeEdgeFunction('gmail-connect', { inbox: resp.inbox });
      if (tab) tab.location = c.url; else window.open(c.url, '_blank');
      showToast(`Connect ${resp.inbox} once (sign in as it in the tab that opened), then press the button again.`, 'warning');
      return;
    }
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Gmail did not save the draft');
    if (tab) tab.location = resp.openUrl; else window.open(resp.openUrl, '_blank');
    showToast(`Draft saved in ${resp.inbox} → Drafts. Check it and hit Send.`, 'success');
  } catch (e) {
    if (tab) tab.close();
    showToast('Could not create the draft: ' + e.message);
  } finally {
    passoffInFlight.end(dealId, 'gmail-draft');
    const b = document.getElementById('cc-draft-btn');
    if (b) { b.disabled = passoffInFlight.any(dealId); b.innerHTML = draftLabel(clientName); }
  }
}

function draftLabel(clientName) {
  return `${svgIcon('mail', 14)} Create draft: lead + ${esc(clientDisplayName(clientName))}`;
}

export function renderColdCallEmailButton(deal, client) {
  const url = coldCallEmailUrl(deal, client);
  if (!url) return '';
  const name = btoa(unescape(encodeURIComponent(client.name)));
  // Drawn from the in-flight map so a re-render mid-save keeps it busy (Tim, 2026-11-12).
  const st = buttonState(passoffInFlight, deal.id, 'gmail-draft', '');
  const label = st.disabled && passoffInFlight.has(deal.id, 'gmail-draft') ? 'Saving draft…' : draftLabel(client.name);
  return `<div style="margin:0 0 8px 0">
    <button id="cc-draft-btn" class="btn btn-primary" ${st.disabled ? 'disabled' : ''}
      style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#0891b2;border-color:#0891b2"
      title="Saves the lead confirmation in ${esc(client.coldCallEmail)} → Drafts, to ${esc(deal.email)} with ${esc(client.name)} CC'd. Nothing is sent."
      onclick="createLeadDraftClick('${esc(deal.id)}',decodeURIComponent(escape(atob('${name}'))))">
      ${label}
    </button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:center">
      Goes to ${esc(client.coldCallEmail)} → Drafts ·
      <a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--text-muted)">or open Gmail compose instead</a>
    </div>
  </div>`;
}

window.createLeadDraftClick = function(dealId, clientName) {
  createLeadDraft(dealId, clientName);
};
