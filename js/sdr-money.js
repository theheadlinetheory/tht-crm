// ═══════════════════════════════════════════════════════════
// SDR MONEY — what an SDR earns per dial ("you make $X every time you click dial",
// from the 2026-11-23 Leevi call). Pure and import-free; tested by scripts/test-sdr-money.mjs.
// Earned = commission only: meetings × the setter's cold-call rate (lead-payout.js setterRates).
// ═══════════════════════════════════════════════════════════

// JustCall login → Lead Tracker setter. Mirrors the CRM DB function setter_for_email();
// a new SDR is added there, to SETTERS (lead-setter.js) and here.
const SETTER_BY_EMAIL = {
  'contact@theheadlinetheory.com': 'Ioannis',
  'leads@theheadlinetheory.com': 'Marcell',
  'marcell.c.tht@gmail.com': 'Marcell',
  'aidan@theheadlinetheory.com': 'Aidan',
};

export const setterForEmail = (email) => SETTER_BY_EMAIL[String(email || '').trim().toLowerCase()] || null;

export const earnedFor = (meetings, rate) => (rate == null ? null : meetings * rate);

export const perDial = (earned, dials) => (earned == null || !dials ? null : earned / dials);
