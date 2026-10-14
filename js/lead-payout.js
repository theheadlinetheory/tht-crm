// ═══════════════════════════════════════════════════════════
// LEAD PAYOUT — what the appointment setter earns per Lead Tracker lead
// ═══════════════════════════════════════════════════════════
// Priced by the channel the lead came from (lead_tracker.lead_source, copied
// from the deal on push). Payroll itself is paid from the tht-payroll ledger;
// its ledger-sync function applies the same two rates — change both together.
export const EMAIL_LEAD_PAY = 27;
export const COLD_CALL_LEAD_PAY = 50;

export function isColdCallLead(entry) {
  return entry.leadSource === 'cold_call';
}

export function leadPayout(entry) {
  return isColdCallLead(entry) ? COLD_CALL_LEAD_PAY : EMAIL_LEAD_PAY;
}
