// ═══════════════════════════════════════════════════════════
// ACQUISITION CHANNEL — which outreach channel a deal came from
// ═══════════════════════════════════════════════════════════
// Derived from deals.lead_source. Everything without a source predates
// multi-channel outreach and came from SmartLead, so it counts as Email.
import { svgIcon } from './utils.js?v=20261009113117';

export const ACQUISITION_CHANNELS = ['Email', 'Cold Calling', 'SMS', 'LinkedIn', 'Other'];

const SOURCE_TO_CHANNEL = {
  '': 'Email',
  smartlead: 'Email',
  aimfox: 'LinkedIn',
  cold_call: 'Cold Calling',
  sms: 'SMS',
  other: 'Other',
};

export function dealChannel(deal) {
  return SOURCE_TO_CHANNEL[deal.leadSource || ''] || 'Other';
}

// Pill shown before the company name on acquisition cards. Channels without
// an entry (Cold Calling/Other have no source wired up yet) show nothing.
const PILL = 'display:inline-flex;align-items:center;margin-right:4px;font-size:9px;font-weight:800;color:#fff;padding:1px 4px;border-radius:3px;vertical-align:middle;font-family:Arial,sans-serif;line-height:11px';
const CHANNEL_BADGES = {
  Email: { title: 'Email lead (SmartLead)', bg: '#7c3aed', content: () => svgIcon('mail', 10, '#fff') },
  LinkedIn: { title: 'LinkedIn lead (Aimfox)', bg: '#0a66c2', content: () => 'in' },
  SMS: { title: 'SMS lead (GoHighLevel)', bg: '#16a34a', content: () => svgIcon('message-circle', 10, '#fff') },
};

export function channelCardBadge(deal) {
  const b = CHANNEL_BADGES[dealChannel(deal)];
  return b ? `<span title="${b.title}" style="${PILL};background:${b.bg}">${b.content()}</span>` : '';
}
