// ═══════════════════════════════════════════════════════════
// LEAD PAYOUT — what the appointment setter earns per Lead Tracker lead
// ═══════════════════════════════════════════════════════════
// Priced by the channel the lead came from (lead_tracker.lead_source, copied
// from the deal on push) at the setter's own rates (SETTERS in lead-setter.js).
// Payroll itself is paid from the tht-payroll ledger, whose employees rows hold
// the same rates (per_lead / cold_call_per_lead) — change both together.
// Defaults = Ioannis's rates, for a setter with none on file.
const EMAIL_LEAD_PAY = 27;
const COLD_CALL_LEAD_PAY = 50;

export function setterRates(setter) {
  return { email: setter?.emailPay ?? EMAIL_LEAD_PAY, coldCall: setter?.coldCallPay ?? COLD_CALL_LEAD_PAY };
}

export function isColdCallLead(entry) {
  return entry.leadSource === 'cold_call';
}

export function leadPayout(entry, setter) {
  const rates = setterRates(setter);
  return isColdCallLead(entry) ? rates.coldCall : rates.email;
}
