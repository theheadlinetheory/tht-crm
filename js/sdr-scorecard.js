// ═══════════════════════════════════════════════════════════
// SDR SCORECARD — admin-only comparison of each SDR's dials, connects, bookings and
// time on the phone, by day / week / month. Lives under Setter Performance on the
// Client Fulfillment dashboard (dashboard.js), never its own tab.
//
// Calls come from cold_calls (JustCall Sales Dialer, synced every 2 min by cold-call-sync,
// the same rows as the Cold Calling tab); sdr_seats says which login (agent_email) is which SDR and holds
// their targets (6 h dialing, 200 dials). Bookings come from the Lead Tracker
// (cold-call rows, by setter; blank setter = Ioannis). Math: sdr-metrics.js.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261123150021';
import { render } from './render.js?v=20261123150021';
import { esc } from './utils.js?v=20261123150021';
import { registerActions } from './delegate.js?v=20261123150021';
import { supabase } from './supabase-client.js?v=20261123150021';
import { selectAllPages } from './paging.js?v=20261123150021';
import { scorecard, etDay, GAP_MIN } from './sdr-metrics.js?v=20261123150021';
import { TREND_WEEKS, rangeOf, shiftAnchor, addDays, trendMondays, neededFrom, loadAction } from './sdr-periods.js?v=20261123150021';

const PERIODS = [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }];
const DEFAULT_SETTER = 'Ioannis';
const EXCLUDED_CLIENTS = ['landy rose media'];
const SDR_COLORS = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444'];
const CARD = 'background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
const RED = '#dc2626';

registerActions({
  sdrPeriod(el) { state.sdrPeriod = el.dataset.p; render(); },
  sdrShift(el) { state.sdrAnchor = shiftAnchor(anchor(), period(), Number(el.dataset.d)); render(); },
});

// ─── Period (ET calendar days as 'YYYY-MM-DD'; math in sdr-periods.js) ───

const utc = (iso) => Date.parse(iso + 'T00:00:00Z');
const today = () => etDay(new Date().toISOString());
const period = () => (PERIODS.some((p) => p.key === state.sdrPeriod) ? state.sdrPeriod : 'week');
const anchor = () => state.sdrAnchor || today();

// ─── Data ───

async function load(fromDay) {
  state.sdrData = { ...(state.sdrData || {}), loading: true };
  try {
    const sinceUtc = new Date(utc(addDays(fromDay, -1))).toISOString();
    const [seats, calls] = await Promise.all([
      selectAllPages(() => supabase.from('sdr_seats').select('*').eq('active', true).order('agent_email')),
      selectAllPages(() => supabase.from('cold_calls').select('call_id,agent_email,called_at,duration_sec,outcome')
        .gte('called_at', sinceUtc).order('call_id')),
    ]);
    state.sdrData = {
      from: fromDay, at: Date.now(),
      seats: seats.map((s) => ({ agentId: s.agent_email, setter: s.setter, targetHours: Number(s.target_hours), targetDials: Number(s.target_dials) })),
      // ET day worked out once here, not on every render
      calls: calls.map((c) => ({ agentId: c.agent_email, calledAt: c.called_at, day: etDay(c.called_at), durationS: c.duration_sec || 0, disposition: c.outcome || '' })),
    };
  } catch (e) {
    console.error('SDR scorecard load failed', e);
    state.sdrData = { error: String(e?.message || e), at: Date.now() };
  }
  render();
}

// Fetches when needed and says whether the loaded data can be drawn for this view.
function ensureLoaded(fromDay) {
  const action = loadAction(state.sdrData, fromDay, Date.now());
  if (action === 'load' || action === 'refresh') load(fromDay);
  return action;
}

// Lead Tracker "MM/DD/YY" → "YYYY-MM-DD"
function bookedIso(dateAdded) {
  const [m, d, y] = String(dateAdded || '').split('/').map(Number);
  if (!m || !d || !y) return null;
  return `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function coldCallBookings() {
  return (state.trackerEntries || [])
    .filter((e) => e.leadSource === 'cold_call')
    .filter((e) => !EXCLUDED_CLIENTS.includes(String(e.clientName || '').trim().toLowerCase()))
    .map((e) => ({ setter: String(e.setter || '').trim() || DEFAULT_SETTER, day: bookedIso(e.dateAdded) }))
    .filter((b) => b.day);
}

// ─── Formatting ───

const n0 = (v) => Math.round(v).toLocaleString('en-US');
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pct = (v) => `${Math.round(v * 100)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso) => { const d = new Date(utc(iso)); return `${WD[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const fmtTime = (iso) => (iso ? ET_TIME.format(new Date(iso)) : '—');

function periodLabel(p, { from, to }) {
  if (p === 'day') return fmtDay(from);
  if (p === 'week') return `Week of ${fmtDay(from)} – ${fmtDay(to)}`;
  return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
}

// ─── Presentation ───

function pill(action, attr, value, label, on) {
  return `<button data-action="${action}" data-${attr}="${value}" style="padding:4px 12px;border-radius:999px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid ${on ? 'var(--purple)' : 'var(--border)'};background:${on ? 'var(--purple)' : '#fff'};color:${on ? '#fff' : 'var(--text-muted)'}">${label}</button>`;
}

function controls(p, label) {
  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    ${PERIODS.map((x) => pill('sdrPeriod', 'p', x.key, x.label, x.key === p)).join('')}
    <span style="width:8px"></span>
    ${pill('sdrShift', 'd', -1, '‹', false)}
    <span style="font-size:12px;font-weight:600;min-width:150px;text-align:center">${esc(label)}</span>
    ${pill('sdrShift', 'd', 1, '›', false)}
  </div>`;
}

// One row per metric, one column per SDR. Output metrics first; time-on-phone below for context.
function comparisonTable(cards, p) {
  const perDay = p !== 'day';
  const rows = [
    ['Dials', (s) => n0(s.totals.dials), (s) => s.totals.dialsPerDay < s.targetDials],
    ...(perDay ? [['Dials per dialing day', (s) => `${n0(s.totals.dialsPerDay)} <span style="color:var(--text-muted)">/ ${s.targetDials}</span>`, (s) => s.totals.dialsPerDay < s.targetDials]] : []),
    ['Connects', (s) => `${n0(s.totals.connects)} <span style="color:var(--text-muted)">(${pct(s.totals.connectRate)})</span>`],
    ['Booked', (s) => `<b>${n0(s.totals.booked)}</b>`],
    ['Dials per booking', (s) => (s.totals.dialsPerBooking === null ? '—' : n0(s.totals.dialsPerBooking))],
    ['Connects → booked', (s) => pct(s.totals.connToBook)],
    ['divider'],
    [perDay ? 'Active hours per dialing day' : 'Active hours', (s) => `${n1(s.totals.activeHPerDay)} <span style="color:var(--text-muted)">/ ${s.targetHours}</span>`],
    ['Utilization', (s) => pct(s.totals.utilization)],
    ['Dials per active hour', (s) => n0(s.totals.dialsPerActiveH)],
    ['Talk time (h)', (s) => n1(s.totals.talkH)],
    ['Breaks over 15 min', (s) => `${s.totals.breakCount} <span style="color:var(--text-muted)">(${n0(s.totals.breakMin)} min)</span>`],
    ...(perDay ? [['Days dialed', (s) => s.totals.dialDays]] : []),
  ];
  const th = 'padding:8px 12px;text-align:right;font-size:11px;font-weight:700';
  const head = `<tr><th style="${th};text-align:left"></th>${cards.map((s, i) => `<th style="${th};color:${SDR_COLORS[i % SDR_COLORS.length]}">${esc(s.setter)}</th>`).join('')}</tr>`;
  const body = rows.map(([label, fmt, isRed]) => {
    if (label === 'divider') return `<tr><td colspan="${cards.length + 1}" style="padding:6px 12px 2px;font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Time on the phone (context)</td></tr>`;
    return `<tr style="border-top:1px solid var(--border)"><td style="padding:7px 12px;font-size:12px;color:var(--text-muted)">${label}</td>${cards.map((s) => `<td style="padding:7px 12px;text-align:right;font-size:13px;color:${isRed && s.totals.dials && isRed(s) ? RED : 'var(--text)'}">${fmt(s)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div style="${CARD};padding:4px 0;overflow-x:auto"><table style="width:100%;border-collapse:collapse">${head}${body}</table></div>`;
}

function dailyTable(cards) {
  const rows = cards.flatMap((s, i) => s.days.map((d) => ({ s, d, color: SDR_COLORS[i % SDR_COLORS.length] })))
    .sort((a, b) => (a.d.day === b.d.day ? 0 : a.d.day < b.d.day ? -1 : 1));
  if (!rows.length) return '';
  const th = 'padding:6px 10px;text-align:right;font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const td = 'padding:6px 10px;text-align:right;font-size:12px';
  const cols = ['Dials', 'Connects', 'Booked', 'Active h', 'Utilization', 'First – last (ET)', 'Breaks'];
  const body = rows.map(({ s, d, color }) => `<tr style="border-top:1px solid var(--border)">
    <td style="${td};text-align:left">${fmtDay(d.day)}</td>
    <td style="${td};text-align:left;font-weight:700;color:${color}">${esc(s.setter)}</td>
    <td style="${td};font-weight:700;color:${d.underTarget ? RED : 'var(--text)'}">${n0(d.dials)}</td>
    <td style="${td}">${n0(d.connects)}</td>
    <td style="${td};font-weight:700">${n0(d.booked)}</td>
    <td style="${td}">${n1(d.activeH)}</td>
    <td style="${td}">${pct(d.utilization)}</td>
    <td style="${td};white-space:nowrap">${fmtTime(d.firstAt)} – ${fmtTime(d.lastAt)}</td>
    <td style="${td};color:var(--text-muted)">${d.breaks.count} · ${d.breaks.minutes} min</td>
  </tr>`).join('');
  return `<h4 style="font-size:13px;font-weight:700;margin:16px 0 6px">Day by day</h4>
    <div style="${CARD};padding:4px 0;overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <tr><th style="${th};text-align:left">Day</th><th style="${th};text-align:left">SDR</th>${cols.map((c) => `<th style="${th}">${c}</th>`).join('')}</tr>${body}
    </table></div>`;
}

// Grouped bars: one group per week, one bar per SDR. `value(totals)` picks the metric.
function trendSvg(weeks, value, fmt) {
  const H = 170, top = 18, bottom = 22, slot = 76, left = 8;
  const nSdr = weeks[0].cards.length, bw = Math.min(22, (slot - 16) / Math.max(nSdr, 1));
  const W = left * 2 + weeks.length * slot;
  const max = Math.max(0.01, ...weeks.flatMap((w) => w.cards.map((s) => value(s.totals)))) * 1.15;
  const y = (v) => H - bottom - (v / max) * (H - top - bottom);
  let marks = `<line x1="${left}" y1="${H - bottom}" x2="${W - left}" y2="${H - bottom}" stroke="var(--border)"/>`;
  weeks.forEach((w, i) => {
    const x0 = left + i * slot + (slot - nSdr * bw) / 2;
    w.cards.forEach((s, j) => {
      const v = value(s.totals), x = x0 + j * bw;
      marks += `<rect x="${x}" y="${y(v)}" width="${bw - 3}" height="${H - bottom - y(v)}" rx="3" fill="${SDR_COLORS[j % SDR_COLORS.length]}"><title>${esc(s.setter)} · week of ${fmtDay(w.from)}: ${fmt(v)}</title></rect>`;
    });
    marks += `<text x="${left + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${MONTHS[Number(w.from.slice(5, 7)) - 1]} ${Number(w.from.slice(8))}</text>`;
  });
  return `<div style="${CARD}"><svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-height:${H}px">${marks}</svg></div>`;
}

function trend(seats, calls, bookings, iso, p) {
  const weeks = trendMondays(iso, p, today())
    .map((from) => ({ from, cards: scorecard({ calls, seats, bookings, from, to: addDays(from, 6) }) }));
  const legend = seats.map((s, j) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><span style="width:10px;height:10px;border-radius:2px;background:${SDR_COLORS[j % SDR_COLORS.length]}"></span>${esc(s.setter)}</span>`).join('');
  const block = (title, svg) => `<div style="min-width:0"><h4 style="font-size:12px;font-weight:700;margin:0 0 6px">${title}</h4>${svg}</div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 6px">
      <h4 style="font-size:13px;font-weight:700;margin:0">Last ${TREND_WEEKS} weeks</h4><div style="font-size:11px;color:var(--text-muted)">${legend}</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
      ${block('Dials per week', trendSvg(weeks, (t) => t.dials, n0))}
      ${block('Booked per week', trendSvg(weeks, (t) => t.booked, n0))}
      ${block('Active hours per dialing day', trendSvg(weeks, (t) => t.activeHPerDay, n1))}
    </div>`;
}

function shell(controlsHtml, body) {
  return `<div style="margin-top:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px">
      <h3 style="font-size:14px;font-weight:700;margin:0">SDR Scorecard</h3>${controlsHtml}
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px">From JustCall's dialer (the same dials as the Cold Calling tab) and the Lead Tracker. Red = under the daily dial target. Connects = someone picked up (not no answer, voicemail, bad number or desk DQ). Active hours = calling with no gap over ${GAP_MIN} min; utilization = active hours ÷ target hours. Times are Eastern.</p>
    ${body}
  </div>`;
}

export function renderSdrScorecard() {
  const p = period(), iso = anchor(), range = rangeOf(iso, p);
  const action = ensureLoaded(neededFrom(iso, p, today()));
  const d = state.sdrData;
  const ctl = controls(p, periodLabel(p, range));
  if (action === 'error') return shell(ctl, `<div style="${CARD};color:${RED};font-size:12px">Couldn't load dialer data: ${esc(d.error)} — retrying in a minute.</div>`);
  // Never draw from data that doesn't cover this view (it would show false zeros)
  if (action === 'load' || !d?.calls || neededFrom(iso, p, today()) < d.from) return shell(ctl, `<div style="${CARD};text-align:center;color:var(--text-muted);font-size:12px">Loading dialer data…</div>`);
  const bookings = coldCallBookings();
  const cards = scorecard({ calls: d.calls, seats: d.seats, bookings, ...range });
  const empty = cards.every((s) => !s.days.length);
  const body = empty
    ? `<div style="${CARD};text-align:center;color:var(--text-muted);font-size:12px">No dials or bookings in this period.</div>`
    : comparisonTable(cards, p) + (p === 'day' ? '' : dailyTable(cards));
  return shell(ctl, body + trend(d.seats, d.calls, bookings, iso, p));
}
