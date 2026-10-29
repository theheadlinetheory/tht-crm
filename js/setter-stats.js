// ═══════════════════════════════════════════════════════════
// SETTER STATS — which days of the week the appointment setter books best
//
// Reads Lead Tracker entries (PPM meetings) by the day each was BOOKED
// (`dateAdded`), not the day the meeting takes place. Counts every meeting set,
// including ones later called back. Rendered under the Weekly Intake chart on
// the Client Fulfillment dashboard; channel = All / Cold email / Cold call.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261030000401';
import { render } from './render.js?v=20261030000401';
import { esc } from './utils.js?v=20261030000401';
import { registerActions } from './delegate.js?v=20261030000401';

// Ioannis's first payroll month
const SETTER_START = '2026-03-01';
// Not an arm's-length client — kept out of every metric
const EXCLUDED_CLIENTS = ['landy rose media'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHANNELS = [
  { key: 'all', label: 'All' },
  { key: 'email', label: 'Cold email' },
  { key: 'cold_call', label: 'Cold call' },
];
const DAY_MS = 864e5;

registerActions({
  setterChannel(el) { state.setterChannel = el.dataset.ch; render(); },
});

// ─── Data ───

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const utcOf = (iso) => Date.parse(iso + 'T00:00:00Z');
const weekdayOf = (iso) => (new Date(utcOf(iso)).getUTCDay() + 6) % 7; // Mon = 0
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// Lead Tracker "MM/DD/YY" → "YYYY-MM-DD"
function bookedIso(dateAdded) {
  const [m, d, y] = String(dateAdded || '').split('/').map(Number);
  if (!m || !d || !y) return null;
  return `${y < 100 ? 2000 + y : y}-${pad2(m)}-${pad2(d)}`;
}

function channelOf(entry) { return entry.leadSource === 'cold_call' ? 'cold_call' : 'email'; }

function bookingDates(channel) {
  return state.trackerEntries
    .filter((e) => !EXCLUDED_CLIENTS.includes(String(e.clientName || '').trim().toLowerCase()))
    .filter((e) => channel === 'all' || channelOf(e) === channel)
    .map((e) => bookedIso(e.dateAdded))
    .filter((iso) => iso && iso >= SETTER_START)
    .sort();
}

// One row per calendar day from `start` to `end`, with that day's bookings.
function dailyCounts(dates, start, end) {
  const perDate = {};
  dates.forEach((iso) => { perDate[iso] = (perDate[iso] || 0) + 1; });
  const days = [];
  for (let t = utcOf(start); t <= utcOf(end); t += DAY_MS) {
    const iso = isoOf(t);
    days.push({ iso, booked: perDate[iso] || 0 });
  }
  return days;
}

function byWeekday(days) {
  return WEEKDAYS.map((name, i) => {
    const these = days.filter((d) => weekdayOf(d.iso) === i);
    const booked = these.reduce((s, d) => s + d.booked, 0);
    return { name, booked, days: these.length, avg: these.length ? booked / these.length : 0 };
  });
}

// Average per Monday-to-Friday day, month by month
function byMonth(days) {
  const months = {};
  days.forEach((d) => {
    const key = d.iso.slice(0, 7);
    const m = (months[key] = months[key] || { key, booked: 0, weekdays: 0 });
    m.booked += d.booked;
    if (weekdayOf(d.iso) < 5) m.weekdays++;
  });
  return Object.values(months)
    .filter((m) => m.weekdays)
    .map((m) => ({ ...m, avg: m.booked / m.weekdays }));
}

function recordWeek(days) {
  const weeks = {};
  days.forEach((d) => {
    const monday = isoOf(utcOf(d.iso) - weekdayOf(d.iso) * DAY_MS);
    weeks[monday] = (weeks[monday] || 0) + d.booked;
  });
  return Object.entries(weeks).reduce((a, b) => (b[1] > a[1] ? b : a), ['', -1]);
}

function setterStats(channel) {
  const dates = bookingDates(channel);
  if (!dates.length) return null;
  // Cold calls are only tagged from the first one on, so that channel starts there
  const start = channel === 'cold_call' ? dates[0] : SETTER_START;
  const days = dailyCounts(dates, start, todayIso());
  const weekdays = byWeekday(days);
  const monFri = weekdays.slice(0, 5);
  const [weekStart, weekCount] = recordWeek(days);
  return {
    start,
    total: dates.length,
    weekdays,
    months: byMonth(days),
    top: weekdays.reduce((a, b) => (b.avg > a.avg ? b : a)),
    recordDay: days.reduce((a, b) => (b.booked > a.booked ? b : a)),
    recordWeek: { iso: weekStart, booked: weekCount },
    workdayAvg: monFri.reduce((s, w) => s + w.booked, 0) / monFri.reduce((s, w) => s + w.days, 0),
  };
}

// ─── Presentation ───

const fmtAvg = (n) => n.toFixed(2);
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const LONG_DAY = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

const CARD = 'background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';

function statTile(label, value, sub) {
  return `<div style="${CARD}">
    <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600">${label}</div>
    <div style="font-size:28px;font-weight:800;color:var(--text)">${value}</div>
    <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>
  </div>`;
}

function channelToggle(active) {
  return `<div style="display:flex;gap:6px">${CHANNELS.map((c) => {
    const on = c.key === active;
    return `<button data-action="setterChannel" data-ch="${c.key}" style="padding:4px 12px;border-radius:999px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid ${on ? 'var(--purple)' : 'var(--border)'};background:${on ? 'var(--purple)' : '#fff'};color:${on ? '#fff' : 'var(--text-muted)'}">${c.label}</button>`;
  }).join('')}</div>`;
}

// Points along one value axis: bars for weekdays, a line for months.
function chartSvg(points, { asLine, highlight, reference }) {
  const H = 200, top = 22, bottom = 24, slot = 64, left = 12;
  const W = left * 2 + points.length * slot;
  const max = Math.max(...points.map((p) => p.value), reference || 0, 0.01) * 1.1;
  const y = (v) => H - bottom - (v / max) * (H - top - bottom);
  const cx = (i) => left + i * slot + slot / 2;

  let marks = `<line x1="${left}" y1="${H - bottom}" x2="${W - left}" y2="${H - bottom}" stroke="var(--border)"/>`;
  if (reference) {
    marks += `<line x1="${left}" y1="${y(reference)}" x2="${W - left}" y2="${y(reference)}" stroke="#9ca3af" stroke-dasharray="4 4"><title>Average for the whole range: ${fmtAvg(reference)}</title></line>`;
  }
  if (asLine) {
    marks += `<polyline fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${points.map((p, i) => `${cx(i)},${y(p.value)}`).join(' ')}"/>`;
  }
  points.forEach((p, i) => {
    const color = p === highlight ? '#4f46e5' : '#c7d2fe';
    marks += asLine
      ? `<circle cx="${cx(i)}" cy="${y(p.value)}" r="4" fill="#4f46e5"><title>${esc(p.title)}</title></circle>`
      : `<rect x="${cx(i) - 22}" y="${y(p.value)}" width="44" height="${H - bottom - y(p.value)}" rx="4" fill="${color}"><title>${esc(p.title)}</title></rect>`;
    marks += `<text x="${cx(i)}" y="${y(p.value) - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${fmtAvg(p.value)}</text>`;
    marks += `<text x="${cx(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${esc(p.label)}</text>`;
  });
  return `<div style="${CARD};overflow-x:auto"><svg width="${W}" height="${H}" style="display:block;margin:0 auto">${marks}</svg></div>`;
}

function chartBlock(title, note, svg) {
  return `<div style="min-width:0">
    <h4 style="font-size:13px;font-weight:700;margin:0 0 2px">${title}</h4>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">${note}</p>
    ${svg}
  </div>`;
}

export function renderSetterStats() {
  const channel = CHANNELS.some((c) => c.key === state.setterChannel) ? state.setterChannel : 'all';
  const s = setterStats(channel);

  let body;
  if (!s) {
    body = `<div style="${CARD};text-align:center;color:var(--text-muted);font-size:12px">No meetings booked on this channel yet.</div>`;
  } else {
    const weekdayPoints = s.weekdays.map((w) => ({ label: w.name, value: w.avg, title: `${LONG_DAY[w.name]}: ${w.booked} booked over ${w.days} days` }));
    const monthPoints = s.months.map((m) => ({ label: MONTHS[Number(m.key.slice(5)) - 1], value: m.avg, title: `${MONTHS[Number(m.key.slice(5)) - 1]} ${m.key.slice(0, 4)}: ${m.booked} booked over ${m.weekdays} weekdays` }));
    body = `<p style="font-size:12px;margin:0 0 12px"><b>${LONG_DAY[s.top.name]}</b> is the hottest day, averaging <b>${fmtAvg(s.top.avg)}</b> meetings booked. Monday to Friday averages <b>${fmtAvg(s.workdayAvg)}</b> a day.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
        ${statTile('Meetings booked', s.total.toLocaleString('en-US'), `since ${fmtDate(s.start)}`)}
        ${statTile('Record day', s.recordDay.booked, fmtDate(s.recordDay.iso))}
        ${statTile('Record week', s.recordWeek.booked, `week of ${fmtDate(s.recordWeek.iso)}`)}
        ${statTile('Mon–Fri average', fmtAvg(s.workdayAvg), 'booked per weekday')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
        ${chartBlock('Average booked per day of the week', 'Meetings booked on that weekday ÷ how many of that weekday fell in the range.',
          chartSvg(weekdayPoints, { highlight: weekdayPoints[s.weekdays.indexOf(s.top)] }))}
        ${chartBlock('Average booked per weekday, month by month', 'Meetings booked in the month ÷ its Mon–Fri days so far. Dashed line = average for the whole range.',
          chartSvg(monthPoints, { asLine: true, reference: s.workdayAvg }))}
      </div>`;
  }

  return `<div style="margin-top:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px">
      <h3 style="font-size:14px;font-weight:700;margin:0">Setter Performance — Booking Days</h3>
      ${channelToggle(channel)}
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px">By the day each meeting was <b>booked</b>, not the day it takes place. Includes meetings later called back.${channel === 'cold_call' ? ' Cold calls are tagged from the first one on, so this view starts there.' : ''}</p>
    ${body}
  </div>`;
}
