// ═══════════════════════════════════════════════════════════
// COLD-CALL EMAIL — first email to a lead booked on a cold call
// ═══════════════════════════════════════════════════════════
// A cold-call lead has no email thread yet, so this starts one: from the
// client's designated inbox (clients.cold_call_email), to the lead, with the
// client CC'd. It opens Gmail compose already filled in, in that inbox (signed
// in on the caller's browser), and the caller reviews it and hits Send.

import { esc, str, applyTemplate, svgIcon } from './utils.js?v=20261028233137';

const SUBJECT = 'Your meeting with {CLIENT}';
const BODY = `Hi {FIRST_NAME},

Thanks for taking my call. This confirms your meeting with {CLIENT} {MEETING_TIME} at {ADDRESS}.

I've copied the {CLIENT} team here so you can reach them directly. They'll call you before they arrive.

Best,
Sean Reynolds
{CLIENT}`;

/** "Woody's Landcare LLC" -> "Woody's Landcare"; the legal suffix reads oddly to a lead. */
export function clientDisplayName(name) {
  return str(name).replace(/[\s,]+(LLC|L\.L\.C\.|Ltd\.?|Inc\.?|Corp\.?)$/i, '').trim();
}

function fill(text, deal, client) {
  const field = key => applyTemplate(key, deal, '', '');
  const meeting = field('{MEETING_TIME}');
  return (field('{ADDRESS}') ? text : text.replace(' at {ADDRESS}', ''))
    .replaceAll('{CLIENT}', clientDisplayName(client.name))
    .replace('{FIRST_NAME}', field('{FIRST_NAME}') || 'there')
    .replace('{MEETING_TIME}', meeting.charAt(0).toLowerCase() + meeting.slice(1))
    .replace('{ADDRESS}', field('{ADDRESS}'));
}

/** Gmail compose URL in the client's cold-call inbox, or null when it can't be sent. */
export function coldCallEmailUrl(deal, client) {
  const from = str(client && client.coldCallEmail).trim();
  const to = str(deal && deal.email).trim();
  if (!from || !to || str(deal.leadSource) !== 'cold_call') return null;
  const params = new URLSearchParams({
    authuser: from,
    view: 'cm',
    fs: '1',
    to,
    cc: str(client.notifyEmails).trim(),
    su: fill(SUBJECT, deal, client),
    // Claude's draft from the pass-off panel (edited by the caller) wins over the fixed template.
    body: str(deal.passoffLeadMessage).trim() || fill(BODY, deal, client),
  });
  return `https://mail.google.com/mail/u/0/?${params}`;
}

export function renderColdCallEmailButton(deal, client) {
  const url = coldCallEmailUrl(deal, client);
  if (!url) return '';
  // A plain link: Gmail compose has to open in its own tab, and a link needs no handler.
  return `<div style="margin:0 0 8px 0">
    <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener"
      style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#0891b2;border-color:#0891b2;text-decoration:none;box-sizing:border-box"
      title="Opens Gmail as ${esc(client.coldCallEmail)}, filled in, to ${esc(deal.email)} with ${esc(client.name)} CC'd">
      ${svgIcon('mail', 14)} Email lead + ${esc(clientDisplayName(client.name))}
    </a>
  </div>`;
}
