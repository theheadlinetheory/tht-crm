// ═══════════════════════════════════════════════════════════
// RENEWALS — the Renewals tab. A read-only table of every retainer client
// ordered by the next date money is due, so the renewal schedule can be
// checked here instead of waiting on the 7/3/1 Slack notices.
//
// The renewal date is clients.renewal_day — a STORED fact, deliberately not
// derivable from the launch date (Denair launched on the 23rd and renews on
// the 29th; Hammer launched on the 14th and renews on the 2nd). retainer_last_
// billed is when payment LANDED, not when we billed, so it is shown as "last
// paid" and never used as the anchor — anchoring on it walks the schedule
// later every month.
//
// The date maths mirrors supabase/functions/_shared/monthly-period.ts, which
// drives the notices, so this table cannot disagree with the emails Aidan
// actually receives: same month-end clamping, and the same guard that a
// "renewal" closing less than one full month is not a renewal (McFarlane
// Douglass launched 2026-08-25 with renewal day 25 — the 25th itself is not
// a renewal).
//
// Admin-only: it shows retainer amounts, and money is admin-gated per the
// repo's role rule.
// ═══════════════════════════════════════════════════════════
import { esc, str } from './utils.js?v=20260905075112';
import { addMonths, prettyDate, prepaidThrough } from './retainer-billing.js?v=20260905075112';

const CURRENCY_SYMBOLS = { usd: '$', cad: 'CA$', aud: 'A$', gbp: '£', eur: '€' };
const NOTICE_DAYS = [7, 3, 1];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── date helpers (ISO strings in, ISO strings out) ───
// state.clients comes through normalizeRow, which stringifies every scalar and
// turns nulls into '' — so renewalDay is '29' and a missing one is '', never 0.

function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function isoOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function partsOf(iso) {
  const s = str(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
}
function daysBetween(aIso, bIso) {
  const a = partsOf(aIso), b = partsOf(bIso);
  if (!a || !b) return null;
  return Math.round((Date.UTC(a.y, a.m, a.d) - Date.UTC(b.y, b.m, b.d)) / 86400000);
}
function addDays(iso, n) {
  const p = partsOf(iso);
  if (!p) return '';
  const t = new Date(Date.UTC(p.y, p.m, p.d) + n * 86400000);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}
function weekdayOf(iso) {
  const p = partsOf(iso);
  return p ? WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()] : '';
}

// Whole months from launch to `on` — 0 before the first anniversary.
function monthsElapsed(launchIso, onIso) {
  const l = partsOf(launchIso), o = partsOf(onIso);
  if (!l || !o) return null;
  let n = (o.y - l.y) * 12 + (o.m - l.m);
  if (o.d < Math.min(l.d, daysInMonth(o.y, o.m))) n -= 1;
  return n;
}

// First renewal falling on or after `fromIso`, clamped into short months so a
// 31st client lands on Feb 28 rather than rolling into March.
function nextRenewalOnOrAfter(day, fromIso) {
  const f = partsOf(fromIso);
  if (!f) return '';
  const thisMonth = isoOf(f.y, f.m, Math.min(day, daysInMonth(f.y, f.m)));
  if (thisMonth >= fromIso) return thisMonth;
  const ny = f.m === 11 ? f.y + 1 : f.y;
  const nm = f.m === 11 ? 0 : f.m + 1;
  return isoOf(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

// Next monthly anniversary, plus which stored column produced it. renewal_day
// is authoritative; the launch day-of-month is only a stand-in, and is labelled
// as a guess so the table never presents it as a fact.
function anniversaryOf(renewalDay, launchIso, todayIso) {
  const day = Number(renewalDay) || (partsOf(launchIso) ? partsOf(launchIso).d : 0);
  if (!day) return { date: '', basis: '' };
  const basis = Number(renewalDay) ? 'renewal day' : 'launch day';
  let r = nextRenewalOnOrAfter(day, todayIso);
  if (partsOf(launchIso)) {
    let ok = false;
    for (let i = 0; i < 24; i++) {
      if (monthsElapsed(launchIso, r) >= 1) { ok = true; break; }
      r = nextRenewalOnOrAfter(day, addDays(r, 1));
    }
    if (!ok) return { date: '', basis: '' };
  }
  return { date: r, basis };
}

// The next 7/3/1 touch still ahead of us. Keyed on the monthly ANNIVERSARY, not
// on a prepaid-adjusted date: the notice cron knows nothing about prepaid
// months, so this has to report what will really be sent.
function nextNotice(anniversaryIso, todayIso) {
  if (!anniversaryIso) return null;
  for (const d of NOTICE_DAYS) {
    const touch = addDays(anniversaryIso, -d);
    if (touch >= todayIso) return { date: touch, touch: d };
  }
  return null;
}

function urgencyOf(daysUntil) {
  if (daysUntil === null) return 'unknown';
  if (daysUntil <= 3) return 'crit';
  if (daysUntil <= 7) return 'warn';
  if (daysUntil <= 14) return 'soon';
  return '';
}

export function money(amount, currency) {
  if (str(amount) === '') return '';
  const cur = (str(currency) || 'usd').toLowerCase();
  const sym = CURRENCY_SYMBOLS[cur] || cur.toUpperCase() + ' ';
  return sym + Number(amount).toLocaleString('en-US');
}

// ─── one row ───
export function buildRenewalRow(c, todayIso) {
  const launch = str(c.launchDate).slice(0, 10);
  const status = str(c.status);
  const agreement = str(c.agreementType) || 'prepaid';
  const renewalDay = str(c.renewalDay);
  const prepaidMonths = str(c.prepaidMonths);
  // Unmapped in api.js FIELD_MAP, so it stays snake_case and arrives as a string.
  const noticesEnabled = str(c.monthly_update_enabled) !== 'false';

  const ann = anniversaryOf(renewalDay, launch, todayIso);

  // A prepaid block still running defers the next money decision to its end.
  const through = prepaidThrough(launch, prepaidMonths);
  const prepaidActive = !!(through && through >= todayIso);

  let renewal = ann.date, basis = ann.basis;
  if (prepaidActive && (!ann.date || through >= ann.date)) {
    renewal = through; basis = 'prepaid term';
  }

  const daysUntil = renewal ? daysBetween(renewal, todayIso) : null;

  const flags = [];
  if (status !== 'active') flags.push({ text: status || 'no status', bad: true });
  if (!launch) flags.push({ text: 'no launch date', bad: true });
  else if (launch > todayIso) flags.push({ text: 'launches ' + prettyDate(launch), bad: false });
  if (agreement === 'month_to_month' && !Number(renewalDay))
    flags.push({ text: 'no renewal day', bad: true });
  if (str(c.monthlyRetainer) === '') flags.push({ text: 'no retainer amount', bad: true });
  if (!noticesEnabled) flags.push({ text: 'notices off', bad: false });
  if (through && through < todayIso)
    flags.push({ text: 'prepaid term ended ' + prettyDate(through), bad: false });
  // The notice cron keys on renewal_day alone and knows nothing about prepaid
  // months, so it warns about a renewal the client has already paid for.
  if (prepaidActive && ann.date && through > ann.date && agreement === 'month_to_month' && Number(renewalDay))
    flags.push({ text: 'prepaid, but notices still fire', bad: false });
  if (!str(c.stripeCustomerId)) flags.push({ text: 'no stripe customer', bad: false });

  const notices = status === 'active' && agreement === 'month_to_month' &&
                  !!Number(renewalDay) && noticesEnabled;

  return {
    name: str(c.name),
    color: str(c.color),
    status, agreement, basis,
    amount: str(c.monthlyRetainer),
    currency: str(c.retainerCurrency) || 'usd',
    launch,
    renewal,
    daysUntil,
    monthNumber: launch && renewal ? monthsElapsed(launch, renewal) : null,
    lastPaid: str(c.retainerLastBilled).slice(0, 10),
    notices,
    nextNotice: notices ? nextNotice(ann.date, todayIso) : null,
    flags,
    urgency: urgencyOf(daysUntil),
  };
}

export function buildRenewalRows(clients, todayIso) {
  return clients
    .filter(c => str(c.billingModel) === 'retainer')
    .map(c => buildRenewalRow(c, todayIso))
    .sort((a, b) => {
      const an = a.daysUntil === null, bn = b.daysUntil === null;
      if (an !== bn) return an ? 1 : -1;
      if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
      return a.name.localeCompare(b.name);
    });
}

// ─── render ───
const URGENCY_COLOR = { crit: '#ef4444', warn: '#b45309', soon: '#059669', '': 'var(--text)', unknown: 'var(--text-muted)' };

function fmtIn(days) {
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days + ' days';
}

export function renderRenewals() {
  const today = (() => {
    const d = new Date();
    return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  })();
  const rows = buildRenewalRows(window.state?.clients || [], today);

  if (!rows.length) {
    return `<div style="padding:24px">
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:32px;text-align:center;color:var(--text-muted);font-size:13px">
        No retainer clients yet. A client shows up here once its Billing Model is set to Retainer in Settings ▸ Clients.
      </div></div>`;
  }

  const active = rows.filter(r => r.status === 'active');
  const soon = active.filter(r => r.daysUntil !== null && r.daysUntil <= 14);
  const silent = active.filter(r => !r.notices);
  const next = rows.find(r => r.daysUntil !== null);

  // Mixed currencies are never summed together — no FX rate is invented here.
  const byCur = {};
  for (const r of active) {
    if (r.amount === '') continue;
    byCur[r.currency] = (byCur[r.currency] || 0) + Number(r.amount);
  }
  const totals = Object.entries(byCur).sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => money(v, cur)).join('  ·  ') || '—';

  const th = 'padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted);white-space:nowrap';
  const td = 'padding:10px 12px;font-size:12px;border-top:1px solid var(--border)';

  const stat = (label, value, note, color) => `
    <div style="flex:1;min-width:170px;background:#fff;border:1px solid var(--border);border-left:4px solid ${color};border-radius:10px;padding:12px 14px">
      <div style="font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${value}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${note}</div>
    </div>`;

  let h = `<div style="padding:20px 24px 40px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px">
      <h2 style="font-size:17px;font-weight:700;margin:0">Retainer Renewals</h2>
      <span style="font-size:11px;color:var(--text-muted)">Read-only — edit dates in Settings ▸ Clients ▸ Retainer Billing</span>
    </div>
    <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 14px;max-width:78ch">
      Every retainer client ordered by the next date money is due. Dates come from the client's
      <strong>renewal day</strong>, the same field the 7/3/1 notices use — not the launch date.
    </p>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${stat('Next renewal', next ? esc(next.name) : '—',
             next ? `${prettyDate(next.renewal)} · ${fmtIn(next.daysUntil)}` : 'none scheduled',
             next ? URGENCY_COLOR[next.urgency] || '#059669' : '#cbd5e1')}
      ${stat('Due in 14 days', soon.length, soon.length ? 'active clients' : 'nothing imminent',
             soon.length ? '#b45309' : '#cbd5e1')}
      ${stat('No Slack notice', silent.length,
             silent.length ? 'active, but never warned' : 'all active clients covered',
             silent.length ? '#ef4444' : '#cbd5e1')}
      ${stat('Monthly value', totals, 'active clients only', '#059669')}
    </div>

    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border);min-width:860px">
      <thead><tr style="background:#f9fafb">
        <th style="text-align:left;${th}">Client</th>
        <th style="text-align:left;${th}">Renews</th>
        <th style="text-align:right;${th}">In</th>
        <th style="text-align:right;${th}">Monthly</th>
        <th style="text-align:center;${th}">Month</th>
        <th style="text-align:left;${th}">Last paid</th>
        <th style="text-align:left;${th}">Slack notice</th>
        <th style="text-align:left;${th}">Watch out for</th>
      </tr></thead>
      <tbody>`;

  for (const r of rows) {
    const dim = r.status !== 'active' ? 'opacity:.6;' : '';
    const dot = r.color
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(r.color)};margin-right:6px"></span>`
      : '';
    const chips = r.flags.length
      ? r.flags.map(f => `<span style="display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;margin:1px 3px 1px 0;background:${f.bad ? '#fef2f2' : '#f3f4f6'};color:${f.bad ? '#b91c1c' : 'var(--text-secondary)'}">${esc(f.text)}</span>`).join('')
      : `<span style="color:var(--text-muted)">—</span>`;
    const notice = r.notices && r.nextNotice
      ? `<span style="color:#16a34a;font-weight:600">${prettyDate(r.nextNotice.date).replace(/, \d{4}$/, '')}</span>
         <span style="color:var(--text-muted)"> · ${r.nextNotice.touch}d before</span>`
      : `<span style="display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-weight:600">none</span>`;

    h += `<tr style="${dim}">
      <td style="${td}">
        <div style="font-weight:600">${dot}${esc(r.name)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);margin-top:1px">${esc(r.status || 'no status')} · ${esc(r.agreement.replace(/_/g, ' '))}</div>
      </td>
      <td style="${td}">
        ${r.renewal
          ? `<div style="font-weight:600">${prettyDate(r.renewal).replace(/, \d{4}$/, '')} <span style="color:var(--text-muted);font-weight:400">${weekdayOf(r.renewal)}</span></div>
             <div style="font-size:10.5px;color:var(--text-muted);margin-top:1px">from ${esc(r.basis)}</div>`
          : `<span style="color:var(--text-muted)">not set</span>`}
      </td>
      <td style="${td};text-align:right;font-weight:700;color:${URGENCY_COLOR[r.urgency] || 'var(--text)'}">${fmtIn(r.daysUntil)}</td>
      <td style="${td};text-align:right;font-weight:600">${r.amount === '' ? '<span style="color:#b91c1c;font-weight:400">not set</span>' : esc(money(r.amount, r.currency))}</td>
      <td style="${td};text-align:center;color:var(--text-secondary)">${r.monthNumber === null ? '—' : r.monthNumber}</td>
      <td style="${td};color:var(--text-secondary)">${r.lastPaid ? prettyDate(r.lastPaid).replace(/, \d{4}$/, '') : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="${td}">${notice}</td>
      <td style="${td}">${chips}</td>
    </tr>`;
  }

  h += `</tbody></table></div>

    <p style="font-size:11px;color:var(--text-muted);margin:12px 0 0;max-width:78ch;line-height:1.6">
      <strong>Slack notice</strong> is when the automation will actually warn you. It only fires for
      <em>active, month-to-month</em> clients that have a renewal day set and monthly updates switched
      on — anything showing <em>none</em> will renew with no warning at all.
      <strong>Month</strong> is which month of the engagement that renewal closes.
      <strong>Last paid</strong> is when payment landed, which is why it is not used to work out the next date.
    </p>
  </div>`;

  return h;
}
