// ═══════════════════════════════════════════════════════════
// $ PER DIAL — Cold Calling → Manager (not for SDRs). What each rep earns every time they
// click dial: commission (meetings × their cold-call rate) ÷ dials. From the 2026-11-23 Leevi
// call: "you literally have a button that gives you $2 every single time you press it."
// $/hour needs the hours from the SDR's EOD (#standard-work-checklist) — coming soon.
// ═══════════════════════════════════════════════════════════
import { esc } from './utils.js?v=20261125104050';
import { setterInfo } from './lead-setter.js?v=20261125104050';
import { setterRates } from './lead-payout.js?v=20261125104050';
import { setterForEmail, earnedFor, perDial } from './sdr-money.js?v=20261125104050';

const PERIODS = [['today', 'Today'], ['week', 'This week'], ['last30', 'Last 30 days']];
const th = 'padding:6px 8px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
const td = 'padding:7px 8px;border-top:1px solid #e2e8f0;font-size:12px;vertical-align:top';
const money = (v, digits = 2) => (v == null ? '—' : '$' + v.toFixed(digits));

/** Cold-call rate for a rep's JustCall login; null for anyone we don't pay per meeting (e.g. Aidan). */
export function rateForEmail(email) {
  const name = setterForEmail(email);
  const s = name && setterInfo(name);
  return s && s.biweeklyBase != null ? setterRates(s).coldCall : null;
}

function periodCells({ dials, booked }, rate) {
  const earned = earnedFor(booked, rate);
  const pd = perDial(earned, dials);
  return `<td style="${td};border-left:1px solid #e2e8f0">${dials}</td><td style="${td}">${booked}</td><td style="${td}">${money(earned, 0)}</td>
    <td style="${td};font-size:15px;font-weight:800;color:${pd ? '#15803d' : '#94a3b8'}" title="Earned ÷ dials">${money(pd)}</td>`;
}

/** reps: [{ name, email, periods: { today, week, last30 } }] — each period { dials, booked } from tally(). */
export function renderDollarsPerDial(reps) {
  if (!reps.length) return '<div style="font-size:12px;color:#94a3b8">No dials yet.</div>';
  const head = PERIODS.map(([, label]) => `<th style="${th};border-left:1px solid #e2e8f0" colspan="4">${label}</th>`).join('');
  const sub = PERIODS.map(() => `<th style="${th};border-left:1px solid #e2e8f0">Dials</th><th style="${th}">Meetings</th><th style="${th}">Earned</th><th style="${th}">$ / dial</th>`).join('');
  const rows = reps.map((r) => {
    const rate = rateForEmail(r.email);
    return `<tr><td style="${td}"><b>${esc(r.name)}</b><div style="font-size:10px;color:#94a3b8">${rate == null ? 'no per-meeting rate' : '$' + rate + ' per meeting'}</div></td>
      ${PERIODS.map(([key]) => periodCells(r.periods[key], rate)).join('')}
      <td style="${td};border-left:1px solid #e2e8f0;color:#cbd5e1" title="Needs the hours from the SDR's EOD report">Coming soon</td></tr>`;
  }).join('');
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>
      <tr><th style="${th}"></th>${head}<th style="${th};border-left:1px solid #e2e8f0">$ / hour</th></tr>
      <tr><th style="${th}">Rep</th>${sub}<th style="${th};border-left:1px solid #e2e8f0"></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:#94a3b8;margin-top:6px"><b style="color:#475569">$ / dial = what the rep makes every time they click dial</b>: commission earned (meetings × their per-meeting rate, base pay not included) ÷ dials. $ / hour arrives once hours from the EOD report are tracked.</div>`;
}
