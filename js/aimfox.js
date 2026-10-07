// ═══════════════════════════════════════════════════════════
// AIMFOX — LinkedIn-outreach cards (created by the aimfox-webhook edge fn)
// ═══════════════════════════════════════════════════════════
import { esc } from './utils.js?v=20261007130251';

const LINKEDIN_BLUE = '#0a66c2';

export function isAimfoxDeal(deal) {
  return deal.leadSource === 'aimfox';
}

/** Replaces the "Smartlead Source" block in the deal modal for LinkedIn leads. */
export function renderAimfoxSource(deal) {
  return `<div class="sl-info" style="background:#eff6ff;border-color:#bfdbfe">
    <div class="sl-info-title" style="color:${LINKEDIN_BLUE}">LinkedIn Source (Aimfox)</div>
    ${deal.campaignName ? `<div>Campaign: ${esc(deal.campaignName)}</div>` : ''}
    ${deal.aimfoxUrl ? `<a href="${esc(deal.aimfoxUrl)}" target="_blank" rel="noopener" style="color:${LINKEDIN_BLUE}">Open in Aimfox →</a>` : ''}
  </div>`;
}
