// ═══════════════════════════════════════════════════════════
// ACQUISITION CHANNEL — which outreach channel a deal came from
// ═══════════════════════════════════════════════════════════
// Derived from deals.lead_source. Everything without a source predates
// multi-channel outreach and came from SmartLead, so it counts as Email.

export const ACQUISITION_CHANNELS = ['Email', 'Cold Calling', 'SMS', 'LinkedIn', 'Other'];

const SOURCE_TO_CHANNEL = {
  '': 'Email',
  smartlead: 'Email',
  aimfox: 'LinkedIn',
  cold_call: 'Cold Calling',
  sms: 'SMS',
};

export function dealChannel(deal) {
  return SOURCE_TO_CHANNEL[deal.leadSource || ''] || 'Other';
}
