// ═══════════════════════════════════════════════════════════
// AIMFOX — LinkedIn-outreach cards (created by the aimfox-webhook edge fn)
// ═══════════════════════════════════════════════════════════
import { esc } from './utils.js?v=20261004150946';

const LINKEDIN_BLUE = '#0a66c2';

export function isAimfoxDeal(deal) {
  return deal.leadSource === 'aimfox';
}

/** Small "in" badge on the pipeline card so LinkedIn leads stand out from email ones. */
export function aimfoxCardBadge(deal) {
  if (!isAimfoxDeal(deal)) return '';
  return `<span title="LinkedIn lead (Aimfox)" style="display:inline-block;margin-left:6px;font-size:9px;font-weight:800;background:${LINKEDIN_BLUE};color:#fff;padding:1px 4px;border-radius:3px;vertical-align:middle;font-family:Arial,sans-serif">in</span>`;
}

/** Replaces the "Smartlead Source" block in the deal modal for LinkedIn leads. */
export function renderAimfoxSource(deal) {
  return `<div class="sl-info" style="background:#eff6ff;border-color:#bfdbfe">
    <div class="sl-info-title" style="color:${LINKEDIN_BLUE}">LinkedIn Source (Aimfox)</div>
    ${deal.campaignName ? `<div>Campaign: ${esc(deal.campaignName)}</div>` : ''}
    ${deal.aimfoxUrl ? `<a href="${esc(deal.aimfoxUrl)}" target="_blank" rel="noopener" style="color:${LINKEDIN_BLUE}">Open in Aimfox →</a>` : ''}
  </div>`;
}
