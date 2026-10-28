// ═══════════════════════════════════════════════════════════
// GHL SMS — cold-SMS reply cards (created by the ghl-sms-webhook edge fn)
// ═══════════════════════════════════════════════════════════
import { esc } from './utils.js?v=20261028231446';

const SMS_GREEN = '#16a34a';
// THT's own GoHighLevel sub-account — the one the cold-SMS workflows run in.
const GHL_LOCATION_ID = 'OMbxeprXlFcXkntLcnJG';

export function isGhlSmsDeal(deal) {
  return deal.leadSource === 'sms';
}

/**
 * Where "Open conversation in GoHighLevel" goes. The conversation id is looked
 * up by the ghl-sms-webhook, so it is always in THT's sub-account; an SMS card
 * without one falls back to the contact's page. ghl_contact_id alone is not
 * enough: push-to-ghl stamps Client-pipeline cards with ids from *clients'*
 * GHL accounts, which would open the wrong account.
 */
export function ghlConversationUrl(deal) {
  const base = `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}`;
  const convId = String(deal.ghlConversationId || '').trim();
  if (convId) return `${base}/conversations/conversations/${encodeURIComponent(convId)}`;
  const contactId = String(deal.ghlContactId || '').trim();
  return contactId && isGhlSmsDeal(deal) ? `${base}/contacts/detail/${encodeURIComponent(contactId)}` : '';
}

function ghlLink(deal) {
  const url = ghlConversationUrl(deal);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:${SMS_GREEN}">Open conversation in GoHighLevel →</a>` : '';
}

/** Replaces the "Smartlead Source" block in the deal modal for SMS leads. */
export function renderGhlSmsSource(deal) {
  return `<div class="sl-info" style="background:#f0fdf4;border-color:#bbf7d0">
    <div class="sl-info-title" style="color:${SMS_GREEN}">SMS Source (GoHighLevel)</div>
    ${deal.campaignName ? `<div>Campaign: ${esc(deal.campaignName)}</div>` : ''}
    ${ghlLink(deal)}
  </div>`;
}

/** For a non-SMS card whose lead has also texted us: just the link, or nothing. */
export function renderGhlConversationLink(deal) {
  const link = ghlLink(deal);
  return link ? `<div style="margin:6px 0 10px">${link}</div>` : '';
}
