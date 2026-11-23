// ═══════════════════════════════════════════════════════════
// ANALYSIS → Meetings view. One row per pay-per-meeting client: cold email,
// cold call and total meetings this week and this month, most-behind first,
// so the morning triage can see who needs cold calling prioritised.
// Live: computed from the Lead Tracker already in memory, no Run step, and it
// re-renders on realtime / background sync (see selfManagedTabActive in api.js).
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261124052057';
import { esc } from './utils.js?v=20261124052057';
import { getPpmClients, isEmailMeeting, resolveClientName } from './dashboard.js?v=20261124052057';
import { buildMeetingsScorecard, MONTH_TARGET, WEEK_TARGET } from './meetings-scorecard.js?v=20261124052057';
import { renderPeriodToggle } from './analysis.js?v=20261124052057';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON = MONTHS.map(m => m.slice(0, 3));
const short = d => `${MON[d.getMonth()]} ${d.getDate()}`;

const STATUS_STYLE = {
  ahead:  'background:#dcfce7;color:#166534',
  close:  'background:#fef3c7;color:#92400e',
  behind: 'background:#fee2e2;color:#991b1b',
};

export function renderMeetingsScorecard() {
  const clients = getPpmClients();
  const { periods: p, expected, rows } = buildMeetingsScorecard({
    entries: state.trackerEntries || [],
    clientNames: clients.map(c => c.name),
    isEmail: isEmailMeeting,
    resolveName: resolveClientName,
    today: new Date(),
  });

  const th = 'padding:6px 10px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border);background:#f9fafb;text-align:center';
  const td = 'padding:7px 10px;font-size:12.5px;border-bottom:1px solid #f1f5f9;text-align:center;font-variant-numeric:tabular-nums';
  const sep = 'border-left:1px solid var(--border)';
  const num = n => n ? String(n) : '<span style="color:#cbd5e1">0</span>';

  let h = `<div class="tracker-container">`;
  h += `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 0 10px">
    <div>
      <div style="font-size:15px;font-weight:800">Meetings — pay-per-meeting clients</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;max-width:760px">
        This week (${short(p.weekStart)} – ${short(p.weekEnd)}) and this month (${MONTHS[p.monthStart.getMonth()]}), split cold email vs cold call. Live from the Lead Tracker, no run needed.
        Target <b>${MONTH_TARGET} meetings per client per month</b> (about ${WEEK_TARGET} a week).
        By today (day ${p.dayOfMonth} of ${p.daysInMonth}) a client on pace has <b>${expected.toFixed(1)}</b>.
        Sorted most-behind first: the top rows are the ones to prioritise for cold calling.
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${renderPeriodToggle('meetings')}</div>
  </div>`;

  if (!state.trackerLoaded) {
    h += `<div style="padding:32px;text-align:center;color:var(--text-muted)">Loading Lead Tracker…</div></div>`;
    return h;
  }

  h += `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:#fff">
  <table style="border-collapse:collapse;width:100%;min-width:640px">
    <thead>
      <tr>
        <th style="${th};text-align:left">Client</th>
        <th style="${th};${sep}">Emails per week</th><th style="${th}">Emails per month</th>
        <th style="${th};${sep}">Calls per week</th><th style="${th}">Calls per month</th>
        <th style="${th};${sep}">Total per week</th><th style="${th}">Total per month</th>
      </tr>
    </thead><tbody>`;

  const sum = { emailWeek: 0, emailMonth: 0, callWeek: 0, callMonth: 0, totalWeek: 0, totalMonth: 0 };
  rows.forEach(r => {
    for (const k of Object.keys(sum)) sum[k] += r[k];
    const weekStyle = r.totalWeek >= WEEK_TARGET ? 'color:#166534;font-weight:700' : '';
    h += `<tr>
      <td style="${td};text-align:left;font-weight:600">${esc(r.name)}</td>
      <td style="${td};${sep}">${num(r.emailWeek)}</td><td style="${td}">${num(r.emailMonth)}</td>
      <td style="${td};${sep}">${num(r.callWeek)}</td><td style="${td}">${num(r.callMonth)}</td>
      <td style="${td};${sep};${weekStyle}">${r.totalWeek}</td>
      <td style="${td};font-weight:800;${STATUS_STYLE[r.status]}">${r.totalMonth}</td>
    </tr>`;
  });
  if (!rows.length) {
    h += `<tr><td colspan="7" style="${td};padding:24px;color:var(--text-muted)">No active pay-per-meeting clients.</td></tr>`;
  } else {
    const tf = `${td};font-weight:800;background:#f9fafb;border-top:1px solid var(--border)`;
    h += `<tr>
      <td style="${tf};text-align:left">All ${rows.length} clients</td>
      <td style="${tf};${sep}">${sum.emailWeek}</td><td style="${tf}">${sum.emailMonth}</td>
      <td style="${tf};${sep}">${sum.callWeek}</td><td style="${tf}">${sum.callMonth}</td>
      <td style="${tf};${sep}">${sum.totalWeek}</td><td style="${tf}">${sum.totalMonth}</td>
    </tr>`;
  }
  h += `</tbody></table></div>`;

  h += `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-top:8px">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;${STATUS_STYLE.ahead}"></span> on pace for ${MONTH_TARGET}</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;${STATUS_STYLE.close}"></span> within 1 of pace</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;${STATUS_STYLE.behind}"></span> behind pace</span>
    <span>Week total turns green at ${WEEK_TARGET}. Meetings are dated by when they were added to the Lead Tracker.</span>
  </div>`;
  h += `</div>`;
  return h;
}
