// ═══════════════════════════════════════════════════════════
// MY PAY — Cold Calling → My Pay (SDRs only): the logged-in setter's own pay for
// this month and last month, worked out like payroll does (sdr-pay.js).
// Reads only the setter's own lead_tracker rows and only fields with no client price.
// ═══════════════════════════════════════════════════════════
import { esc, getToday } from './utils.js?v=20261125121741';
import { currentUser } from './auth.js?v=20261125121741';
import { supabase } from './supabase-client.js?v=20261125121741';
import { selectAllPages } from './paging.js?v=20261125121741';
import { render } from './render.js?v=20261125121741';
import { setterInfo } from './lead-setter.js?v=20261125121741';
import { setterRates } from './lead-payout.js?v=20261125121741';
import { setterForEmail } from './sdr-money.js?v=20261125121741';
import { monthPay, prevMonth } from './sdr-pay.js?v=20261125121741';

const th = 'padding:6px 8px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
const td = 'padding:7px 8px;border-top:1px solid #e2e8f0;font-size:12px';
const CARD = 'background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px';
const STATUS = {
  held: ['Held', '#15803d'],
  upcoming: ['Upcoming', '#2563eb'],
  called_back: ['Called back: $0', '#dc2626'],
};
const money = (v) => '$' + Number(v).toLocaleString('en-US');
const monthLabel = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const mp = { rows: null, loading: false, error: '' };

/** Forget the loaded rows so the next visit reads fresh ones. */
export function resetMyPay() { mp.rows = null; }

async function load(setter) {
  mp.loading = true;
  try {
    mp.rows = await selectAllPages(() => supabase.from('lead_tracker')
      .select('id,lead_name,client_name,date_added,appt_date,callback_status,lead_source')
      .eq('setter', setter).order('id'));
    mp.error = '';
  } catch (e) {
    mp.error = String(e?.message || e);
  }
  mp.loading = false;
  render();
}

function stat(label, value, sub, color = '#0f172a') {
  return `<div style="flex:1;min-width:150px"><div style="font-size:11px;color:#64748b;font-weight:600">${label}</div>
    <div style="font-size:24px;font-weight:800;color:${color}">${value}</div><div style="font-size:11px;color:#94a3b8">${sub}</div></div>`;
}

function monthCard(p, ym, isCurrent) {
  const stats = isCurrent
    ? stat('On track for', money(p.onTrack), 'if no upcoming lead calls back', '#15803d')
      + stat('Earned so far', money(p.earned), `${money(p.base)} base + ${p.heldCount} held meetings`)
      + stat('Upcoming', money(p.upcoming), `${p.upcomingCount} meetings still to happen`)
    : stat('Total for the month', money(p.onTrack), 'paid early next month', '#15803d')
      + stat('Meetings paid', String(p.heldCount + p.upcomingCount), `+ ${money(p.base)} base`);
  const rows = p.leads.map((l) => {
    const [label, color] = STATUS[l.status];
    return `<tr><td style="${td}">${esc(l.day)}</td><td style="${td}">${esc(l.lead_name || '')}</td><td style="${td}">${esc(l.client_name || '')}</td>
      <td style="${td};color:${color};font-weight:600">${label}</td><td style="${td}">${money(l.pay)}</td></tr>`;
  }).join('');
  return `<div style="${CARD}">
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${monthLabel(ym)}</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">${stats}
      ${stat('Called back', String(p.calledBackCount), 'not paid', p.calledBackCount ? '#dc2626' : '#0f172a')}</div>
    ${p.leads.length ? `<details><summary style="cursor:pointer;font-size:12px;color:var(--purple);font-weight:600">Show the ${p.leads.length} meetings</summary>
      <table style="width:100%;border-collapse:collapse;margin-top:8px"><thead><tr><th style="${th}">Appointment</th><th style="${th}">Lead</th><th style="${th}">Client</th><th style="${th}">Status</th><th style="${th}">You earn</th></tr></thead>
      <tbody>${rows}</tbody></table></details>` : '<div style="font-size:12px;color:#94a3b8">No meetings this month yet.</div>'}
  </div>`;
}

export function renderMyPay() {
  const setter = setterForEmail(currentUser?.email);
  const info = setter && setterInfo(setter);
  if (!info || info.biweeklyBase == null) return '<div style="font-size:12px;color:#94a3b8">No pay plan on file for this login. Ask Aidan.</div>';
  if (!mp.rows && !mp.loading && !mp.error) load(setter);
  if (mp.error) return `<div style="font-size:12px;color:#dc2626">Couldn't load your pay: ${esc(mp.error)}</div>`;
  if (!mp.rows) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading your pay…</div>';

  const today = getToday();
  const ym = today.slice(0, 7);
  const opts = { rates: setterRates(info), monthlyBase: info.biweeklyBase * 2, today };
  const rate = opts.rates.coldCall;
  const last = monthPay(mp.rows, { ...opts, ym: prevMonth(ym) }); // hidden before the setter's first month
  return `<div style="font-size:12px;color:#64748b;margin-bottom:12px">${money(rate)} per meeting + ${money(opts.monthlyBase)} a month base.
      A meeting counts in the month of its appointment and pays nothing if the lead calls back.
      Each month is paid early the next month, once client callbacks have settled.</div>`
    + monthCard(monthPay(mp.rows, { ...opts, ym }), ym, true)
    + (last.leads.length ? monthCard(last, prevMonth(ym), false) : '');
}
