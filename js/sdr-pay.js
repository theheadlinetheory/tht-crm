// ═══════════════════════════════════════════════════════════
// SDR PAY — what a setter is owed for a month, the same way payroll pays it.
// Pure and import-free; tested by scripts/test-sdr-pay.mjs. Shown by my-pay.js.
// Mirrors tht-payroll ledger-sync: a lead pays in the month of its appointment
// (date_added if there is none), a called-back lead pays nothing, and the base is
// one line a month. Change both together.
// ═══════════════════════════════════════════════════════════

/** Lead Tracker dates are M/D/YY → 'YYYY-MM-DD' (null if unreadable). */
export function mdyToIso(v) {
  const p = String(v || '').trim().split('/');
  if (p.length !== 3 || p.some((x) => !/^\d+$/.test(x))) return null;
  const y = +p[2] < 100 ? 2000 + +p[2] : +p[2];
  return `${y}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
}

export const payDay = (row) => mdyToIso(String(row.appt_date || '').includes('/') ? row.appt_date : row.date_added);

const calledBack = (row) => String(row.callback_status || '').trim().toLowerCase() === 'called back';

/**
 * rows: the setter's own lead_tracker rows. rates: { email, coldCall }. monthlyBase: number.
 * ym: 'YYYY-MM'. today: 'YYYY-MM-DD'.
 * Each lead gets a status: 'held' (appointment has happened), 'upcoming', or 'called_back' (pays $0).
 */
export function monthPay(rows, { rates, monthlyBase, ym, today }) {
  const leads = rows
    .map((r) => ({ ...r, day: payDay(r) }))
    .filter((r) => r.day && r.day.slice(0, 7) === ym)
    .map((r) => {
      const status = calledBack(r) ? 'called_back' : r.day <= today ? 'held' : 'upcoming';
      const rate = r.lead_source === 'cold_call' ? rates.coldCall : rates.email;
      return { ...r, status, pay: status === 'called_back' ? 0 : rate };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  const sum = (status) => leads.filter((l) => l.status === status).reduce((t, l) => t + l.pay, 0);
  const count = (status) => leads.filter((l) => l.status === status).length;
  const held = sum('held');
  const upcoming = sum('upcoming');
  return {
    leads, base: monthlyBase, held, upcoming,
    heldCount: count('held'), upcomingCount: count('upcoming'), calledBackCount: count('called_back'),
    earned: monthlyBase + held,
    onTrack: monthlyBase + held + upcoming,
  };
}

/** 'YYYY-MM' of the month before ym. */
export function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
