// ═══════════════════════════════════════════════════════════
// COLD CALLING TAB — the SDR's whole job on one page, and the sales manager's view of it
// ═══════════════════════════════════════════════════════════
//
// Sub-tabs:
//   Call Queue   — which client to call now (ranked), my numbers today / this week against quota,
//                  call-backs that are due. Where an SDR starts every day.
//   Pipeline     — the Client Leads board again, cold-call cards only (an SDR never sees email leads;
//                  a manager can switch to all leads). Same deals, not a copy: a card moved here is
//                  moved on Client Leads too. Extra column: Callbacks (under contract / call me later).
//   Lead Tracker — every meeting already booked for each client (so nobody double-books a property),
//                  or only my own bookings.
//   Industries   — which industry / property type books meetings, ranked from the dials themselves.
//   Feedback     — the caller's notes on lists and industries (wrong property types, bad numbers, what works),
//                  as a backlog for whoever builds the lists. Seeded with what Ioannis said on the Oct calls.
//   Manager      — not for SDRs: client ranking against the weekly cap, every rep's numbers against
//                  quota, show / no-show marking, quotas and which clients we cold call for.
//
// The numbers come from cold_calls: one row per JustCall Sales Dialer dial, filled every 2 minutes by
// the cold-call-sync edge function (which also creates the card for every "Appointment Booked", "Under Contract"
// and "Follow Up" call). A rep is the JustCall agent email = their CRM login.
// A meeting = a dial dispositioned "Appointment Booked", or the dial behind a card booked later from the card
// (booked_on, stamped when the deal reaches the lead tracker / a pass-off), minus any a manager marked not_counted.
// Meetings count on the day they were booked, dials on the day they were made.
//
// Rules from the 2026-10-27/28 calls (Aidan, Ioannis, Tim):
//   connection = someone picked up: every dial except no answer, voicemail, bad number and desk DQ.
//   Cap: 2 cold-call meetings per client per week (Mon–Sun), then that client's lists are closed.
//   Unlimited (Aidan, 2026-11-05): a manager can mark some clients (e.g. Lightning) unlimited. They still stop at 2
//   like everyone else; only once EVERY cold-calling client has 2 this week do the unlimited ones reopen with no
//   ceiling. Where the client sits in the order earns nothing: the whole list has to be finished first.
//   Order: retainer clients first, then pay-per-meeting; fewest meetings this week first.

import { state } from './app.js?v=20261114162507';
import { render } from './render.js?v=20261114162507';
import { supabase } from './supabase-client.js?v=20261114162507';
import { esc, str, svgIcon, getToday, jsArg } from './utils.js?v=20261114162507';
import { currentUser, isSdr, isAdmin, isEmployee, loadAssignableUsers } from './auth.js?v=20261114162507';
import { registerActions } from './delegate.js?v=20261114162507';

export const CALLBACK_STAGE = 'Cold Call Callback';
const NO_CONNECTION = new Set(['no_answer', 'voicemail', 'bad_number', 'desk_dq']);
const OUTCOME_LABEL = {
  booked: 'Appointment booked', not_interested: 'Not interested', under_contract: 'Under contract', follow_up: 'Follow up',
  manager_not_around: 'Manager not around', no_answer: 'No answer', voicemail: 'Voicemail',
  bad_number: 'Bad number', desk_dq: 'Desk DQ', picked_up: 'Picked up (no disposition)',
};
// A dial's industry as the fulfillment dashboard names it (the lead list its phone came from, stamped by
// cold-call-sync); a phone in no fulfillment list falls back to the JustCall list's own segment name.
const isMeeting = r => !r.not_counted && (r.outcome === 'booked' || !!r.booked_on);
const meetingDate = r => r.booked_on || r.call_date;
const industryOf = r => r.fulfillment_industry || r.industry || 'Unclassified';
const DEFAULT_QUOTAS = { dialsPerDay: 100, connectionsPerDay: 30, bookedPerWeek: 10, showRate: 80, capPerClient: 2 };
const SUBTABS = [
  { id: 'queue', label: 'Call Queue' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'tracker', label: 'Lead Tracker' },
  { id: 'industries', label: 'Industries' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'manager', label: 'Manager', managerOnly: true },
];
const LOOKBACK_DAYS = 365; // the Industries ranking wants every dial; the call log is small
const POLL_MS = 120000;

const cc = {
  loaded: false, loading: false, error: '',
  calls: [],                 // cold_calls rows, last LOOKBACK_DAYS
  quotas: { ...DEFAULT_QUOTAS },
  pinned: [],                // client names the manager pinned to the top
  order: [],                 // client names in the order the manager dragged them (empty = automatic order)
  snowForecast: {},          // lowercased client name → [{start,end,cm,cities}], written by fulfillment snowstorm-alert
  snowUpdated: '',
  snowManual: {},            // client name → {mode:'on'|'off', until:'YYYY-MM-DD', by}
  unlimited: [],             // client names with no weekly ceiling once every client has hit the cap
  syncing: false, syncNote: '',
  tracker: null, trackerLoading: false,
  trackerScope: 'all', trackerClient: '', trackerSearch: '',
  manualDeal: '',            // lead-card cache key for the call history section
};
const _history = new Map();  // deal id → rendered call history HTML
let _pollTimer = null;

// ─── Dates (the rep's local calendar; weeks run Monday–Sunday) ───
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}
const today = () => getToday();
const thisWeek = () => weekStart(today());

// ─── Data ───
async function loadAll() {
  if (cc.loading) return;
  cc.loading = true;
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('cold_calls')
        .select('call_id,campaign_name,client_name,phone10,contact_name,company,agent_email,agent_name,called_at,call_date,duration_sec,disposition,outcome,notes,recording_url,deal_id,show_status,industry,fulfillment_industry,property_type,booked_on,not_counted')
        .gte('call_date', since).order('call_id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    cc.calls = rows;
    if (!(state.assignableUsers || []).length) await loadAssignableUsers().catch(() => null);
    const { data: settings } = await supabase.from('crm_settings').select('key,value').in('key', ['cold_call_quotas', 'cold_call_pinned', 'cold_call_unlimited', 'cold_call_order', 'cold_call_snow_forecast', 'cold_call_snow_manual']);
    for (const s of settings || []) {
      try {
        if (s.key === 'cold_call_quotas') cc.quotas = { ...DEFAULT_QUOTAS, ...JSON.parse(s.value) };
        if (s.key === 'cold_call_pinned') cc.pinned = JSON.parse(s.value) || [];
        if (s.key === 'cold_call_unlimited') cc.unlimited = JSON.parse(s.value) || [];
        if (s.key === 'cold_call_order') cc.order = JSON.parse(s.value) || [];
        if (s.key === 'cold_call_snow_forecast') { const v = JSON.parse(s.value) || {}; cc.snowForecast = v.clients || {}; cc.snowUpdated = v.updated_at || ''; }
        if (s.key === 'cold_call_snow_manual') cc.snowManual = JSON.parse(s.value) || {};
      } catch (_) { /* a bad row keeps the defaults */ }
    }
    cc.error = '';
    cc.loaded = true;
  } catch (e) {
    console.error('Cold calling load failed:', e);
    cc.error = e.message || String(e);
    cc.loaded = true;
  } finally {
    cc.loading = false;
  }
  if (state.pipeline === 'cold_calling') render();
}

/** Called on every render of the tab: first load, then a quiet refresh every 2 minutes while it is open. */
export function ensureColdCallData() {
  if (!cc.loaded && !cc.loading) loadAll();
  if (!_pollTimer) {
    _pollTimer = setInterval(() => {
      if (state.pipeline !== 'cold_calling') { clearInterval(_pollTimer); _pollTimer = null; return; }
      if (!document.hidden) loadAll();
    }, POLL_MS);
  }
}

async function saveSetting(key, value) {
  const { error } = await supabase.from('crm_settings').upsert(
    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) alert('Could not save: ' + error.message);
}

// ─── Metrics ───
/** Dials made and meetings booked between from and to (inclusive dates; no dates = all of rows). */
function tally(all, from = '', to = '9999-12-31') {
  const rows = all.filter(r => r.call_date >= from && r.call_date <= to);
  const dials = rows.length;
  const connections = rows.filter(r => !NO_CONNECTION.has(r.outcome)).length;
  const booked = all.filter(r => isMeeting(r) && meetingDate(r) >= from && meetingDate(r) <= to);
  const showed = booked.filter(r => r.show_status === 'showed').length;
  const noShow = booked.filter(r => r.show_status === 'no_show').length;
  return {
    dials, connections, booked: booked.length,
    connectRate: dials ? Math.round(100 * connections / dials) : null,
    showRate: showed + noShow ? Math.round(100 * showed / (showed + noShow)) : null,
    showed, noShow,
  };
}
const callsOn = (from, to = '9999-12-31') => cc.calls.filter(r => r.call_date >= from && r.call_date <= to);

/** Rep identity = the JustCall agent email = their CRM login. */
function repName(email) {
  const u = (state.assignableUsers || []).find(x => (x.email || '').toLowerCase() === email);
  if (u && u.name) return u.name;
  const any = cc.calls.find(r => r.agent_email === email);
  return (any && any.agent_name) || email || 'Unknown';
}

// ─── Client ranking ───
const isOn = v => v === true || v === 'true';
export function coldCallClients() {
  return (state.clients || []).filter(c => c.status !== 'inactive' && isOn(c.coldCalling));
}

// ─── Snowstorm priority ───
// The day before a storm through SNOW_AFTER_DAYS after it is when property managers find out their snow vendor
// can't keep up, so those clients jump to the top of the queue. Storms come from the fulfillment snowstorm-alert
// function (Open-Meteo forecast for each snow client's watch cities); the manager can switch it on or off by hand.
const SNOW_BEFORE_DAYS = 1, SNOW_AFTER_DAYS = 3, SNOW_HEADS_UP_DAYS = 5, SNOW_MANUAL_DAYS = 4;
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
/** {active, upcoming, storm, manual} for a client today. */
function snowFor(name) {
  const t = today();
  const storms = (cc.snowForecast[str(name).toLowerCase().trim()] || []).filter(s => s && s.start && s.end);
  const live = storms.find(s => t >= addDays(s.start, -SNOW_BEFORE_DAYS) && t <= addDays(s.end, SNOW_AFTER_DAYS));
  const soon = !live && storms.filter(s => s.start > t && s.start <= addDays(t, SNOW_HEADS_UP_DAYS)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const m = cc.snowManual[name];
  const manual = m && m.until >= t ? m : null;
  if (manual && manual.mode === 'off') return { active: false, upcoming: null, storm: live || null, manual };
  if (manual && manual.mode === 'on') return { active: true, upcoming: null, storm: live || null, manual };
  return { active: !!live, upcoming: soon || null, storm: live || null, manual: null };
}
function snowBadge(r) {
  const sn = r.snow;
  if (sn.active) {
    const s = sn.storm;
    const tip = s ? `${s.cm} cm forecast ${fmtDay(s.start)}${s.end !== s.start ? ' – ' + fmtDay(s.end) : ''} in ${(s.cities || []).join(', ')}. Call the day before, the day of and a few days after.`
      : `Snow priority switched on by ${sn.manual && sn.manual.by || 'the manager'} until ${sn.manual && fmtDay(sn.manual.until)}.`;
    return ` <span title="${esc(tip)}" style="font-size:10px;font-weight:800;color:#fff;background:#0284c7;padding:2px 8px;border-radius:8px;letter-spacing:.3px;white-space:nowrap">❄️ SNOWSTORM: CALL NOW</span>`;
  }
  if (sn.upcoming) {
    const s = sn.upcoming;
    return ` <span title="${esc(`${s.cm} cm forecast in ${(s.cities || []).join(', ')}. This client moves to the top the day before.`)}" style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;padding:1px 7px;border-radius:8px;white-space:nowrap">❄️ Snow ${esc(fmtDay(s.start))}</span>`;
  }
  return '';
}

/** Snowstorm clients first (unless capped); then retainers, then pay-per-meeting; within each, the manager's dragged order if there is one (clients not in
 *  it come after), otherwise pinned first; then fewest meetings this week; capped last.
 *  An unlimited client reopens (unlocked) only once every client switched on has reached the cap this week. */
export function rankedClients() {
  const week = callsOn(thisWeek());
  const cap = Number(cc.quotas.capPerClient) || 2;
  const rows = coldCallClients().map(c => {
    const bookedWeek = cc.calls.filter(r => r.client_name === c.name && isMeeting(r) && meetingDate(r) >= thisWeek()).length;
    return {
      client: c,
      name: c.name,
      retainer: str(c.billingModel) === 'retainer',
      pinned: cc.pinned.includes(c.name),
      snow: snowFor(c.name),
      unlimited: cc.unlimited.includes(c.name),
      bookedWeek,
      dialsWeek: week.filter(r => r.client_name === c.name).length,
      atCap: bookedWeek >= cap,
      cap,
    };
  });
  const everyoneAtCap = rows.length > 0 && rows.every(r => r.atCap);
  for (const r of rows) {
    r.unlocked = r.unlimited && everyoneAtCap;
    r.capped = r.atCap && !r.unlocked;
    r.lastSlot = !r.capped && !r.unlocked && r.cap - r.bookedWeek === 1;
  }
  const pos = name => { const i = cc.order.indexOf(name); return i < 0 ? 1e6 : i; };
  // Once the manager has dragged, their order decides within each group (it already starts from the pins).
  const manual = cc.order.length > 0;
  rows.sort((a, b) =>
    (a.capped - b.capped) || (b.snow.active - a.snow.active) || (b.retainer - a.retainer) ||
    (manual ? (pos(a.name) - pos(b.name)) : 0) || (b.pinned - a.pinned) ||
    (a.bookedWeek - b.bookedWeek) || a.name.localeCompare(b.name));
  return rows;
}

// ─── Board (search.js asks these for the Cold Calling pipeline) ───
export function coldCallStages() {
  const cols = rankedClients().map((r, i) => ({
    id: r.name, label: (r.snow.active ? '❄️ ' : '') + r.name,
    color: r.capped ? '#9ca3af' : r.retainer ? '#2563eb' : '#059669',
    rank: i + 1,
  }));
  const head = [{ id: CALLBACK_STAGE, label: 'Callbacks', color: '#16a34a' }];
  if (!isSdr()) head.push({ id: 'Client Not Distributed', label: 'Not Distributed', color: '#6b7280' });
  return [...head, ...cols];
}

function callbackDue(dealId) {
  const pending = (state.activities || []).filter(a => a.dealId === dealId && !a.done && String(a.done) !== 'TRUE');
  return pending.map(a => (a.dueDate || '').slice(0, 10)).filter(Boolean).sort()[0] || '9999-12-31';
}

export function coldCallDeals() {
  const names = new Set(coldCallStages().map(s => s.id));
  const allLeads = !isSdr() && state.ccAllLeads;
  const deals = state.deals.filter(d => d.pipeline === 'Client' && names.has(d.stage) &&
    (d.stage === CALLBACK_STAGE || allLeads || d.leadSource === 'cold_call'));
  // Callbacks: the due ones (green / red badge) on top.
  return deals.sort((a, b) => a.stage === CALLBACK_STAGE && b.stage === CALLBACK_STAGE
    ? callbackDue(a.id).localeCompare(callbackDue(b.id)) : 0);
}

/** "1/2 this week" (or CAPPED) under a client column's title. */
export function coldCallColumnMeta(stageId) {
  if (stageId === CALLBACK_STAGE) {
    const due = coldCallDeals().filter(d => d.stage === CALLBACK_STAGE && callbackDue(d.id) <= today()).length;
    return due ? ` · <span style="font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;padding:1px 6px;border-radius:8px">${due} due</span>` : '';
  }
  const r = rankedClients().find(x => x.name === stageId);
  if (!r) return '';
  if (r.unlocked) return ` · <b style="color:#0f172a">${r.bookedWeek}</b> this week ${UNLIMITED_BADGE}`;
  const badge = r.capped
    ? `<span title="${r.unlimited ? `Unlimited client: reopens once every client has ${r.cap} meetings this week.` : 'Weekly cap reached. Do not call for this client until Monday.'}" style="font-size:9px;font-weight:800;color:#fff;background:#6b7280;padding:1px 6px;border-radius:8px;letter-spacing:.3px">CAPPED</span>`
    : `<span style="font-size:9px;font-weight:700;color:${r.retainer ? '#1d4ed8' : '#047857'};background:${r.retainer ? '#dbeafe' : '#d1fae5'};padding:1px 6px;border-radius:8px">${r.retainer ? 'RETAINER' : 'PPM'}</span>`;
  return ` · <b style="color:${r.capped ? '#6b7280' : '#0f172a'}">${r.bookedWeek}/${r.cap}</b> this week ${badge}${r.lastSlot ? ' ' + LAST_SLOT_BADGE : ''}`;
}

// ─── Last slot of the weekly cap (audit A3 #6, 2026-11-13) ───
// The counts above come from a copy of cold_calls reloaded every 2 minutes, filled by a sync that also runs every
// 2 minutes, so two SDRs could both book a client's last paid meeting. One short of the cap, the count is re-read
// from the database before the calendar opens, and the client wears this badge.
const LAST_SLOT_BADGE = `<span title="One meeting left this week. Another SDR may be booking it right now: the count is re-checked when you open the calendar, and a booking made in the last 2 minutes may not show yet." style="font-size:9px;font-weight:800;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:1px 6px;border-radius:8px;letter-spacing:.3px;white-space:nowrap">LAST SLOT — CHECK BEFORE BOOKING</span>`;

/** This week's counted meetings for one client, read from the database now (not the 2-minute copy). */
async function liveMeetingsThisWeek(clientName) {
  const wk = thisWeek();
  const { data, error } = await supabase.from('cold_calls').select('call_id,outcome,booked_on,call_date,not_counted')
    .eq('client_name', clientName).or(`call_date.gte.${wk},booked_on.gte.${wk}`);
  if (error) throw error;
  return (data || []).filter(r => isMeeting(r) && meetingDate(r) >= wk).length;
}

/**
 * Call before showing a client's Calendly link. Only when the client is one meeting short of its cap does it go to
 * the database; then it returns ok:false if the cap is already reached (and updates the local copy so the queue shows
 * it), or ok:true with lastSlot so the caller can warn. A failed read never blocks booking: it says so instead.
 */
export async function checkSlotBeforeBooking(clientName) {
  const r = rankedClients().find(x => x.name === clientName);
  if (!r || !r.lastSlot) return { ok: true };
  try {
    const live = await liveMeetingsThisWeek(clientName);
    if (live >= r.cap) {
      loadAll().then(() => render()).catch(() => {});
      return { ok: false, count: live, cap: r.cap, message: `${clientName} already has ${live}/${r.cap} meetings this week — the cap is reached. Book for another client.` };
    }
    return { ok: true, lastSlot: true, count: live, cap: r.cap, message: `Last slot for ${clientName} this week (${live}/${r.cap}). A booking another SDR made in the last 2 minutes may not show yet.` };
  } catch (e) {
    return { ok: true, lastSlot: true, message: `Could not re-check ${clientName}'s meetings (${e.message}). This is their last slot this week — check before booking.` };
  }
}
if (typeof window !== 'undefined') window.ccCheckSlotBeforeBooking = checkSlotBeforeBooking;

// ─── Shared pieces ───
const UNLIMITED_BADGE = `<span title="Every client has hit the weekly cap, so this client has no limit for the rest of the week." style="font-size:9px;font-weight:800;color:#fff;background:#7c3aed;padding:1px 6px;border-radius:8px;letter-spacing:.3px">UNLIMITED</span>`;
/** Meetings this week against the cap, or a plain count once an unlimited client has reopened. */
function capCell(r) {
  if (r.unlocked) return `<span style="font-size:12px;font-weight:700;color:#6d28d9">${r.bookedWeek} this week · no limit</span>`;
  return bar(r.bookedWeek, r.cap, { cap: true });
}
function pct(n, d) { return d ? Math.min(100, Math.round(100 * n / d)) : 0; }
function bar(value, target, { suffix = '', higherIsBetter = true, cap = false } = {}) {
  const ok = value == null ? null : higherIsBetter ? value >= target : value <= target;
  // A client's weekly cap is a ceiling, not a target: blue while open, grey once it is full.
  const color = cap ? (value >= target ? '#9ca3af' : '#3b82f6')
    : ok == null ? '#cbd5e1' : ok ? '#16a34a' : (value >= target * 0.6 ? '#d97706' : '#dc2626');
  return `<div style="display:flex;align-items:center;gap:8px">
    <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${value == null ? 0 : pct(value, target)}%;background:${color}"></div></div>
    <span style="font-size:11px;color:#64748b;white-space:nowrap">${value == null ? '—' : value + suffix} / ${target}${suffix}</span>
  </div>`;
}
function statCard(label, value, target, opts = {}) {
  return `<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px">${label}</div>
    <div style="font-size:24px;font-weight:800;color:#0f172a;margin:4px 0 8px">${value == null ? '—' : value + (opts.suffix || '')}</div>
    ${bar(value, target, opts)}
  </div>`;
}
const section = (title, body, right = '') => `<div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:14px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:13px;font-weight:800;color:#0f172a">${title}</div>${right}</div>${body}</div>`;
const th = 'padding:6px 8px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
const td = 'padding:7px 8px;border-top:1px solid #e2e8f0;font-size:12px;vertical-align:top';

/** Working days of this week so far, today included (Mon = 1 … Fri–Sun = 5). Weekly targets scale with it. */
function weekdaysSoFar() {
  const dow = new Date(today() + 'T12:00:00').getDay(); // 0 = Sunday
  return dow === 0 || dow === 6 ? 5 : dow;
}

/** Today + this week for a set of dials, against quota (the week's target is pro-rated to today). */
function repStatsHtml(rows) {
  const q = cc.quotas;
  const d = tally(rows, today(), today());
  const w = tally(rows, thisWeek());
  const days = weekdaysSoFar();
  const row = (label, t, dials, conns, booked) => `<div style="margin-bottom:10px">
    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px">${label}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${statCard('Dials', t.dials, dials)}
      ${statCard('Connections', t.connections, conns)}
      ${statCard('Meetings booked', t.booked, booked)}
      ${statCard('Show rate', t.showRate, q.showRate, { suffix: '%' })}
    </div></div>`;
  return row('Today', d, q.dialsPerDay, q.connectionsPerDay, Math.max(1, Math.round(q.bookedPerWeek / 5)))
    + row(`This week <span style="font-weight:400;color:#94a3b8">(target so far: ${days} of 5 days; full week ${q.dialsPerDay * 5} dials, ${q.bookedPerWeek} meetings)</span>`,
      w, q.dialsPerDay * days, q.connectionsPerDay * days, Math.max(1, Math.round(q.bookedPerWeek * days / 5)));
}

// ─── Header (sub-tabs + sync) ───
export function renderColdCallingHeader() {
  ensureColdCallData();
  const sub = state.coldCallSubTab || 'queue';
  const subCs = 'padding:6px 16px;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;border-radius:6px;margin-right:4px';
  const last = cc.calls.map(r => r.called_at || '').sort().pop();
  const lastTxt = last ? new Date(last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
  return `<div style="padding:0 20px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
    <div style="display:flex;gap:4px">
      ${SUBTABS.filter(t => !t.managerOnly || !isSdr()).map(t => `<button data-action="ccSubTab" data-tab="${t.id}" style="${subCs};background:${sub === t.id ? 'var(--purple)' : '#f3f4f6'};color:${sub === t.id ? '#fff' : 'var(--text-muted)'}">${t.label}</button>`).join('')}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${sub === 'pipeline' && !isSdr() ? `<button data-action="ccToggleAllLeads" style="padding:4px 12px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid ${state.ccAllLeads ? 'var(--purple)' : 'var(--border)'};border-radius:6px;background:${state.ccAllLeads ? '#f3e8ff' : '#fff'};color:${state.ccAllLeads ? 'var(--purple)' : 'var(--text-muted)'}">${state.ccAllLeads ? 'Showing: all leads' : 'Showing: cold-call leads'}</button>` : ''}
      <span style="font-size:11px;color:#94a3b8">${cc.syncNote ? esc(cc.syncNote) + ' · ' : ''}last dial synced ${esc(lastTxt)}</span>
      <button class="btn btn-ghost" data-action="ccSync" ${cc.syncing ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:4px"><span${cc.syncing ? ' style="animation:spin .7s linear infinite;display:inline-flex"' : ''}>${svgIcon('refresh-cw', 12)}</span> ${cc.syncing ? 'Pulling JustCall…' : 'Refresh from JustCall'}</button>
    </div>
  </div>`;
}

// ─── Call Queue (the SDR's start page) ───
function queueHtml() {
  const ranked = rankedClients();
  const firstOpen = ranked.find(r => !r.capped);
  let h = '';
  const rows = ranked.map((r, i) => {
    const status = r.capped
      ? (r.unlimited
        ? `<span style="font-weight:800;color:#6b7280">AT ${r.cap}: unlimited once every client has ${r.cap}</span>`
        : `<span style="font-weight:800;color:#6b7280">CAPPED: do not call until Monday</span>`)
      : r === firstOpen
        ? `<span style="font-weight:800;color:#15803d">CALL NOW</span>`
        : `<span style="color:#64748b">Next</span>`;
    return `<tr style="${r.capped ? 'opacity:.55' : r.snow.active ? 'background:#f0f9ff' : ''}">
      <td style="${td};font-weight:800;color:#0f172a">${i + 1}</td>
      <td style="${td}"><div style="font-weight:700;color:#0f172a">${esc(r.name)}${snowBadge(r)}${r.pinned ? ' <span title="Pinned by the sales manager">📌</span>' : ''}${r.lastSlot ? ' ' + LAST_SLOT_BADGE : ''}${r.unlocked ? ' ' + UNLIMITED_BADGE : r.unlimited ? ' <span title="No weekly limit once every client has hit the cap" style="font-size:10px;color:#7c3aed;font-weight:700">∞</span>' : ''}</div>
        <div style="font-size:11px;color:#64748b">${r.retainer ? 'Retainer' : 'Pay per meeting'}${r.client.coldCallEmail ? ' · pass-offs from ' + esc(r.client.coldCallEmail) : ''}</div></td>
      <td style="${td};min-width:160px">${capCell(r)}</td>
      <td style="${td}">${status}</td>
    </tr>`;
  }).join('');
  h += section('Who to call, in this order',
    ranked.length
      ? `<div style="font-size:12px;color:#475569;margin-bottom:8px">Stay on the client at the top until they have ${cc.quotas.capPerClient} meetings this week, then move down. Retainer clients come first. A capped client's lists are closed until Monday: those meetings don't get paid.${ranked.some(r => r.unlimited) ? ` Clients marked ∞ have no limit, but only after <b>every</b> client on this list has ${cc.quotas.capPerClient}, including the ones below them.` : ''}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">#</th><th style="${th}">Client</th><th style="${th}">Meetings this week</th><th style="${th}">Status</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div style="font-size:12px;color:#94a3b8">No clients are switched on for cold calling. A manager turns them on in Manager → Clients.</div>`);

  const me = (currentUser && currentUser.email || '').toLowerCase();
  const mine = cc.calls.filter(r => r.agent_email === me);
  h += section(`My numbers${mine.length ? '' : ' (no dials under ' + esc(me) + ' yet)'}`, repStatsHtml(mine),
    `<span style="font-size:11px;color:#94a3b8">Connections = someone picked up (not no answer, voicemail, bad number or desk DQ)</span>`);

  const callbacks = state.deals.filter(d => d.pipeline === 'Client' && d.stage === CALLBACK_STAGE)
    .map(d => ({ d, due: callbackDue(d.id) })).sort((a, b) => a.due.localeCompare(b.due));
  const dueNow = callbacks.filter(c => c.due <= today());
  h += section(`Callbacks due (${dueNow.length})`,
    dueNow.length
      ? `<table style="width:100%;border-collapse:collapse"><tbody>${dueNow.map(({ d, due }) => `<tr style="cursor:pointer" data-action="ccOpenDeal" data-id="${esc(d.id)}">
          <td style="${td}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${due < today() ? '#ef4444' : '#22c55e'};margin-right:6px"></span><b>${esc(d.company || d.contact || 'Lead')}</b></td>
          <td style="${td};color:#475569">${esc(d.coldCallClient || '')}</td>
          <td style="${td}">${esc(d.phone || '')}</td>
          <td style="${td};color:${due < today() ? '#dc2626' : '#15803d'};font-weight:600">${due < today() ? 'overdue since ' + esc(due) : 'due today'}</td></tr>`).join('')}</tbody></table>`
      : `<div style="font-size:12px;color:#94a3b8">Nothing due. ${callbacks.length} callback${callbacks.length === 1 ? '' : 's'} scheduled later. "Under Contract" and "Follow Up" calls land in Pipeline → Callbacks with a reminder, and show up here when it turns green.</div>`);
  return h;
}

// ─── Lead Tracker (every booked meeting, so nobody double-books) ───
async function loadTracker() {
  if (cc.trackerLoading) return;
  cc.trackerLoading = true;
  try {
    const [lt, po] = await Promise.all([
      supabase.from('lead_tracker').select('deal_id,client_name,lead_name,lead_email,date_added,appt_date,appt_time,lead_source,setter').order('created_at', { ascending: false }).limit(2000),
      supabase.from('pass_offs').select('deal_id,client_name,company,contact,email,date_passed,appt_date,appt_time').order('date_passed', { ascending: false }).limit(2000),
    ]);
    if (lt.error) throw lt.error;
    if (po.error) throw po.error;
    const rows = [
      ...(lt.data || []).map(r => ({ client: r.client_name, lead: r.lead_name, email: r.lead_email, booked: (r.date_added || '').slice(0, 10), appt: [r.appt_date, r.appt_time].filter(Boolean).join(' '), source: (r.lead_source === 'cold_call' ? 'Cold call' : 'Email') + ' · ' + (r.setter || 'Ioannis'), dealId: r.deal_id, where: 'PPM tracker' })),
      ...(po.data || []).map(r => ({ client: r.client_name, lead: [r.company, r.contact].filter(Boolean).join(' — '), email: r.email, booked: (r.date_passed || '').slice(0, 10), appt: [r.appt_date, r.appt_time].filter(Boolean).join(' '), source: 'Passed off', dealId: r.deal_id, where: 'Retainer pass-off' })),
    ];
    // Booked on the board but not delivered yet: still a booking.
    const delivered = new Set(rows.map(r => r.dealId).filter(Boolean));
    for (const d of state.deals) {
      if (d.pipeline !== 'Client' || !d.bookedDate || delivered.has(d.id) || d.stage === CALLBACK_STAGE) continue;
      rows.push({ client: d.stage, lead: [d.company, d.contact].filter(Boolean).join(' — '), email: d.email, booked: (d.createdDate || d.createdAt || '').slice(0, 10), appt: [d.bookedDate, d.bookedTime].filter(Boolean).join(' '), source: d.leadSource === 'cold_call' ? 'Cold call' : 'Email', dealId: d.id, where: 'On the board' });
    }
    cc.tracker = rows.sort((a, b) => (b.booked || '').localeCompare(a.booked || ''));
  } catch (e) {
    cc.tracker = { error: e.message || String(e) };
  } finally {
    cc.trackerLoading = false;
  }
  render();
}

function trackerHtml() {
  if (!cc.tracker && !cc.trackerLoading) loadTracker();
  const scopeBtn = (id, label) => `<button data-action="ccTrackerScope" data-scope="${id}" style="padding:5px 12px;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid ${cc.trackerScope === id ? 'var(--purple)' : 'var(--border)'};border-radius:6px;background:${cc.trackerScope === id ? '#f3e8ff' : '#fff'};color:${cc.trackerScope === id ? 'var(--purple)' : 'var(--text-muted)'}">${label}</button>`;
  const clients = coldCallClients().map(c => c.name).sort();
  const controls = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    ${scopeBtn('all', 'All booked meetings')} ${scopeBtn('mine', 'My bookings')}
    <select data-action="ccTrackerClient" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px">
      <option value="">All clients</option>${clients.map(n => `<option value="${esc(n)}" ${cc.trackerClient === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <input id="cc-tracker-search" data-action="ccTrackerSearch" placeholder="Search property, contact, email…" value="${esc(cc.trackerSearch)}" style="flex:1;min-width:200px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px">
  </div>`;
  const q = cc.trackerSearch.toLowerCase().trim();
  const match = (...vals) => !q || vals.some(v => str(v).toLowerCase().includes(q));

  if (cc.trackerScope === 'mine') {
    const me = (currentUser && currentUser.email || '').toLowerCase();
    const mine = cc.calls.filter(r => r.agent_email === me && isMeeting(r) &&
      (!cc.trackerClient || r.client_name === cc.trackerClient) && match(r.contact_name, r.campaign_name, r.client_name))
      .sort((a, b) => meetingDate(b).localeCompare(meetingDate(a)));
    return section('My bookings', controls + (mine.length
      ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Booked on</th><th style="${th}">Client</th><th style="${th}">Contact</th><th style="${th}">List</th><th style="${th}">Showed?</th></tr></thead><tbody>
        ${mine.map(r => `<tr ${r.deal_id && r.deal_id !== 'claiming' ? `style="cursor:pointer" data-action="ccOpenDeal" data-id="${esc(r.deal_id)}"` : ''}>
          <td style="${td}">${esc(meetingDate(r))}</td><td style="${td}">${esc(r.client_name || '?')}</td><td style="${td}">${esc(r.contact_name || '')}</td>
          <td style="${td};color:#64748b">${esc(r.campaign_name || '')}</td>
          <td style="${td}">${r.show_status === 'showed' ? '<b style="color:#15803d">Showed</b>' : r.show_status === 'no_show' ? '<b style="color:#dc2626">No-show</b>' : '<span style="color:#94a3b8">Pending</span>'}</td></tr>`).join('')}</tbody></table>`
      : `<div style="font-size:12px;color:#94a3b8">No meetings booked under ${esc(me)} in the last ${LOOKBACK_DAYS} days.</div>`));
  }

  if (cc.trackerLoading || !cc.tracker) return section('All booked meetings', controls + '<div style="font-size:12px;color:#94a3b8">Loading…</div>');
  if (cc.tracker.error) return section('All booked meetings', controls + `<div style="font-size:12px;color:#dc2626">Couldn't load the tracker: ${esc(cc.tracker.error)}</div>`);
  const rows = cc.tracker.filter(r => (!cc.trackerClient || r.client === cc.trackerClient) && match(r.lead, r.email, r.client));
  return section(`All booked meetings (${rows.length})`, controls +
    `<div style="font-size:12px;color:#475569;margin-bottom:8px">Every meeting already booked for our clients, from email and cold calls. Check the property here before booking it, so we never book the same lead twice.</div>
    <div style="max-height:calc(100vh - 300px);overflow:auto"><table style="width:100%;border-collapse:collapse"><thead style="position:sticky;top:0;background:#f8fafc"><tr><th style="${th}">Booked</th><th style="${th}">Client</th><th style="${th}">Property / contact</th><th style="${th}">Email</th><th style="${th}">Appointment</th><th style="${th}">Source</th></tr></thead><tbody>
    ${rows.slice(0, 500).map(r => `<tr><td style="${td};white-space:nowrap">${esc(r.booked || '')}</td><td style="${td}">${esc(r.client || '')}</td><td style="${td};font-weight:600">${esc(r.lead || '')}</td><td style="${td};color:#475569">${esc(r.email || '')}</td><td style="${td};white-space:nowrap">${esc(r.appt || '')}</td><td style="${td};color:#64748b" title="${esc(r.where)}">${esc(r.source)}</td></tr>`).join('')}
    </tbody></table></div>`);
}

// ─── Manager ───
function managerHtml() {
  const ranked = rankedClients();
  const week = callsOn(thisWeek());
  let h = '';

  h += section('Clients this week', ranked.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr>
      <th style="${th}">#</th><th style="${th}">Client</th><th style="${th}">Model</th><th style="${th}">Meetings / cap</th><th style="${th}">Dials</th><th style="${th}">Connections</th><th style="${th}">Connect %</th><th style="${th}">Showed / no-show</th><th style="${th}"></th></tr></thead><tbody>
    ${ranked.map((r, i) => {
      const t = tally(cc.calls.filter(x => x.client_name === r.name), thisWeek());
      const all = tally(cc.calls.filter(x => x.client_name === r.name));
      return `<tr draggable="true" data-cc-row="${esc(r.name)}" style="${r.capped ? 'background:#f1f5f9' : ''}">
        <td style="${td};font-weight:800;white-space:nowrap"><span class="cc-drag" title="Drag to move this client up or down the call queue" style="cursor:grab;color:#94a3b8;margin-right:6px;user-select:none">⋮⋮</span>${i + 1}</td>
        <td style="${td};font-weight:700">${esc(r.name)}${snowBadge(r)} ${r.unlocked ? UNLIMITED_BADGE : r.capped ? '<span style="font-size:9px;font-weight:800;color:#fff;background:#6b7280;padding:1px 6px;border-radius:8px">CAPPED</span>' : ''}</td>
        <td style="${td}">${r.retainer ? 'Retainer' : 'PPM'}</td>
        <td style="${td};min-width:140px">${capCell(r)}</td>
        <td style="${td}">${t.dials}</td><td style="${td}">${t.connections}</td><td style="${td}">${t.connectRate == null ? '—' : t.connectRate + '%'}</td>
        <td style="${td}" title="Last ${LOOKBACK_DAYS} days">${all.showed} / ${all.noShow}</td>
        <td style="${td};white-space:nowrap"><button data-action="ccPin" data-name="${esc(r.name)}" style="font-size:11px;padding:3px 9px;border:1px solid var(--border);border-radius:6px;background:${r.pinned ? '#fef3c7' : '#fff'};color:#334155;cursor:pointer;font-weight:600">${r.pinned ? 'Unpin' : '📌 Pin'}</button>
          <button data-action="ccSnow" data-name="${esc(r.name)}" title="${r.snow.active ? 'Take this client off snowstorm priority for now' : 'Put this client at the top of the queue for the next ' + SNOW_MANUAL_DAYS + ' days'}" style="font-size:11px;padding:3px 9px;border:1px solid ${r.snow.active ? '#0284c7' : 'var(--border)'};border-radius:6px;background:${r.snow.active ? '#e0f2fe' : '#fff'};color:${r.snow.active ? '#0369a1' : '#334155'};cursor:pointer;font-weight:600">${r.snow.active ? '❄️ End snow priority' : '❄️ Snow priority'}</button>
          <button data-action="ccUnlimited" data-name="${esc(r.name)}" title="No weekly limit for this client once every client has hit the cap" style="font-size:11px;padding:3px 9px;border:1px solid ${r.unlimited ? '#7c3aed' : 'var(--border)'};border-radius:6px;background:${r.unlimited ? '#f5f3ff' : '#fff'};color:${r.unlimited ? '#6d28d9' : '#334155'};cursor:pointer;font-weight:600">${r.unlimited ? '∞ Unlimited' : '∞ Make unlimited'}</button></td></tr>`;
    }).join('')}</tbody></table>
    <div style="font-size:11px;color:#94a3b8;margin-top:6px">Drag a client by ⋮⋮ to move it up or down the call queue. Retainers always stay above pay-per-meeting clients and capped clients always sink to the bottom; dragging reorders within those groups. ❄️ Snowstorm clients jump to the top from the day before a storm until ${SNOW_AFTER_DAYS} days after it (forecast for each snow client's watch cities${cc.snowUpdated ? ', checked ' + esc(new Date(cc.snowUpdated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}). ${cc.order.length ? `<b style="color:#475569">Using your dragged order.</b> <button data-action="ccResetOrder" style="font-size:11px;padding:1px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:#334155;cursor:pointer">Reset to automatic order</button>` : 'Automatic order: pinned first, then fewest meetings this week.'} The week resets every Monday. ∞ Unlimited clients stop at the cap like everyone else, and reopen with no limit once every client has hit it.</div>`
    : '<div style="font-size:12px;color:#94a3b8">No clients switched on yet. Use the list below.</div>');

  // Reps: one row each, every number coloured against its quota (the week pro-rated to today).
  const rq = cc.quotas, days = weekdaysSoFar();
  const cell = (v, target, suffix = '') => {
    const color = v == null ? '#94a3b8' : v >= target ? '#15803d' : v >= target * 0.6 ? '#b45309' : '#dc2626';
    return `<td style="${td};font-weight:700;color:${color}" title="target ${target}${suffix}">${v == null ? '—' : v + suffix}</td>`;
  };
  const reps = [...new Set(cc.calls.filter(r => r.call_date >= thisWeek() || r.call_date === today()).map(r => r.agent_email).filter(Boolean))].sort();
  h += section('Industries', industryVerdictTable(), `<span style="font-size:11px;color:#94a3b8">${cc.calls.length} dials in the last ${LOOKBACK_DAYS} days</span>`);

  h += section('Reps', reps.length ? `<table style="width:100%;border-collapse:collapse"><thead>
      <tr><th style="${th}"></th><th style="${th};border-left:1px solid #e2e8f0" colspan="3">Today</th><th style="${th};border-left:1px solid #e2e8f0" colspan="5">This week</th></tr>
      <tr><th style="${th}">Rep</th><th style="${th};border-left:1px solid #e2e8f0">Dials</th><th style="${th}">Connections</th><th style="${th}">Booked</th>
        <th style="${th};border-left:1px solid #e2e8f0">Dials</th><th style="${th}">Connections</th><th style="${th}">Connect %</th><th style="${th}">Booked</th><th style="${th}">Show rate</th></tr></thead><tbody>
      ${reps.map(email => {
        const mine = cc.calls.filter(r => r.agent_email === email);
        const d = tally(mine, today(), today());
        const w = tally(mine, thisWeek());
        const all = tally(mine);
        return `<tr><td style="${td}"><b>${esc(repName(email))}</b><div style="font-size:10px;color:#94a3b8">${esc(email)}</div></td>
          ${cell(d.dials, rq.dialsPerDay)}${cell(d.connections, rq.connectionsPerDay)}${cell(d.booked, Math.max(1, Math.round(rq.bookedPerWeek / 5)))}
          ${cell(w.dials, rq.dialsPerDay * days)}${cell(w.connections, rq.connectionsPerDay * days)}<td style="${td}">${w.connectRate == null ? '—' : w.connectRate + '%'}</td>
          ${cell(w.booked, Math.max(1, Math.round(rq.bookedPerWeek * days / 5)))}${cell(all.showRate, rq.showRate, '%')}</tr>`;
      }).join('')}</tbody></table>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px">Green = on quota, amber = within 60%, red = behind. The week's targets count ${days} of 5 working days so far. Show rate is over the last ${LOOKBACK_DAYS} days (it needs the meetings to have happened).</div>`
    : '<div style="font-size:12px;color:#94a3b8">No dials this week yet.</div>');

  // Dispositions this week, per client: where the dials go (list quality shows up in bad number / desk DQ).
  const order = ['booked', 'under_contract', 'follow_up', 'not_interested', 'manager_not_around', 'picked_up', 'no_answer', 'voicemail', 'bad_number', 'desk_dq'];
  const byClient = ranked.map(r => ({ name: r.name, rows: week.filter(x => x.client_name === r.name) })).filter(x => x.rows.length);
  h += section('Dispositions this week', byClient.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Client</th>
      ${order.map(o => `<th style="${th}">${esc(OUTCOME_LABEL[o])}</th>`).join('')}<th style="${th}">Dials</th></tr></thead><tbody>
      ${[...byClient, { name: 'All clients', rows: week }].map(x => `<tr${x.name === 'All clients' ? ' style="font-weight:700;background:#f1f5f9"' : ''}><td style="${td}">${esc(x.name)}</td>
        ${order.map(o => { const n = x.rows.filter(r => r.outcome === o).length; return `<td style="${td};color:${n ? '#0f172a' : '#cbd5e1'}">${n}${n && x.rows.length ? `<span style="color:#94a3b8;font-size:10px"> ${Math.round(100 * n / x.rows.length)}%</span>` : ''}</td>`; }).join('')}
        <td style="${td};font-weight:700">${x.rows.length}</td></tr>`).join('')}</tbody></table></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px">"Picked up (no disposition)" = JustCall connected the call but no outcome was picked. Every call should get one.</div>`
    : '<div style="font-size:12px;color:#94a3b8">No dials this week yet.</div>');

  const booked = cc.calls.filter(isMeeting).sort((a, b) => meetingDate(b).localeCompare(meetingDate(a)));
  h += section('Booked meetings: did they show?', booked.length ? `<div style="font-size:12px;color:#475569;margin-bottom:8px">The client tells us in their reply to the pass-off (within 24 hours of the meeting). Mark it here; it drives every show rate.</div>
    <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Booked</th><th style="${th}">Client</th><th style="${th}">Contact</th><th style="${th}">Rep</th><th style="${th}">Showed?</th></tr></thead><tbody>
    ${booked.map(r => `<tr><td style="${td}">${esc(meetingDate(r))}</td><td style="${td}">${esc(r.client_name || '?')}</td><td style="${td}">${esc(r.contact_name || '')}</td><td style="${td}">${esc(repName(r.agent_email))}</td>
      <td style="${td};white-space:nowrap">${['showed', 'no_show'].map(s => `<button data-action="ccShow" data-id="${r.call_id}" data-status="${s}" style="font-size:11px;padding:3px 9px;margin-right:4px;border-radius:6px;cursor:pointer;border:1px solid ${r.show_status === s ? (s === 'showed' ? '#16a34a' : '#dc2626') : 'var(--border)'};background:${r.show_status === s ? (s === 'showed' ? '#dcfce7' : '#fee2e2') : '#fff'};font-weight:600">${s === 'showed' ? 'Showed' : 'No-show'}</button>`).join('')}</td></tr>`).join('')}
    </tbody></table>` : `<div style="font-size:12px;color:#94a3b8">No booked meetings in the last ${LOOKBACK_DAYS} days.</div>`);

  const q = cc.quotas;
  const qInput = (key, label) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#64748b">${label}
    <input type="number" min="0" id="ccq-${key}" value="${esc(q[key])}" style="width:110px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px"></label>`;
  h += section('Quotas (per rep)', `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      ${qInput('dialsPerDay', 'Dials / day')}${qInput('connectionsPerDay', 'Connections / day')}${qInput('bookedPerWeek', 'Meetings / week')}${qInput('showRate', 'Show rate %')}${qInput('capPerClient', 'Cap / client / week')}
      <button class="btn btn-primary" data-action="ccSaveQuotas" style="font-size:12px">Save quotas</button></div>`);

  const active = (state.clients || []).filter(c => c.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name));
  h += section('Which clients we cold call for', `<div style="display:flex;flex-wrap:wrap;gap:6px">
    ${active.map(c => `<label style="display:flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid ${isOn(c.coldCalling) ? '#7c3aed' : 'var(--border)'};border-radius:6px;background:${isOn(c.coldCalling) ? '#f5f3ff' : '#fff'};font-size:12px;cursor:pointer">
      <input type="checkbox" data-action="ccToggleClient" data-id="${esc(c.id)}" ${isOn(c.coldCalling) ? 'checked' : ''}> ${esc(c.name)} <span style="color:#94a3b8;font-size:10px">${str(c.billingModel) === 'retainer' ? 'retainer' : 'PPM'}</span></label>`).join('')}
    </div><div style="font-size:11px;color:#94a3b8;margin-top:6px">A client switched on gets a column on the Pipeline and a row in the Call Queue. Give them a cold-call inbox in Settings → Clients so pass-offs go from it.</div>`);

  h += section('SDR access', `<div style="font-size:12px;color:#475569">An SDR signs in with their @theheadlinetheory.com Google account and sees only this tab. To set one up: give them the <b>sdr</b> role in Settings → Users, and a JustCall Sales Dialer seat under the same email, so their dials count as theirs.</div>`);
  return h;
}

// ─── Industries: which segment books meetings, ranked from the dials ───
// Ranked on the cautious end of meetings per 100 dials (the 95% Wilson lower bound), so 1 booking in 3 dials can't
// outrank 6 in 380. Ties (every segment at 0 booked) break on under-contract calls (future pipeline), then on the
// share of dials that reached a person, then on the lowest desk-DQ rate (how well the list fits). Segments with
// fewer than MIN_DIALS dials are listed after the rest: too early to rank against them.
function wilsonLow(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n, z2 = z * z;
  return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n));
}
const MIN_DIALS = 50; // below this a segment is shown but flagged as too early to judge

function segmentRows(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r) || 'Unclassified';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([name, rs]) => {
    const t = tally(rs);
    const n = (o) => rs.filter(r => r.outcome === o).length;
    return {
      name, dials: t.dials, connections: t.connections, booked: t.booked,
      underContract: n('under_contract'), notInterested: n('not_interested'), deskDq: n('desk_dq'), badNumber: n('bad_number'),
      clients: [...new Set(rs.map(r => r.client_name).filter(Boolean))],
      per100: t.dials ? 100 * t.booked / t.dials : 0,
      low: 100 * wilsonLow(t.booked, t.dials),
      connectRate: t.dials ? t.connections / t.dials : 0,
      dqRate: t.dials ? n('desk_dq') / t.dials : 0,
    };
  }).sort((a, b) => ((a.dials < MIN_DIALS) - (b.dials < MIN_DIALS)) || (b.low - a.low) || (b.underContract / (b.dials || 1) - a.underContract / (a.dials || 1)) ||
    (b.connectRate - a.connectRate) || (a.dqRate - b.dqRate) || (b.dials - a.dials));
}

function rankingTable(segs, label) {
  const pctTxt = v => Math.round(100 * v) + '%';
  return `<table style="width:100%;border-collapse:collapse"><thead><tr>
    <th style="${th}">#</th><th style="${th}">${label}</th><th style="${th}">Dials</th><th style="${th}">Reached a person</th>
    <th style="${th}">Meetings</th><th style="${th}" title="Meetings booked per 100 dials">Per 100 dials</th>
    <th style="${th}" title="Cautious estimate (95% lower bound): what the ranking uses">Ranked on</th>
    <th style="${th}">Under contract</th><th style="${th}" title="Not a fit for this client (desk DQ)">Desk DQ</th><th style="${th}">Not interested</th></tr></thead><tbody>
    ${segs.map((s, i) => {
      const early = s.dials < MIN_DIALS;
      return `<tr style="${early ? 'color:#94a3b8' : ''}">
        <td style="${td};font-weight:800">${i + 1}</td>
        <td style="${td}"><b style="color:${early ? '#94a3b8' : '#0f172a'}">${esc(s.name)}</b>${early ? ` <span style="font-size:9px;font-weight:700;background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:8px">TOO EARLY (&lt;${MIN_DIALS} dials)</span>` : ''}
          <div style="font-size:10px;color:#94a3b8">${esc(s.clients.join(', '))}</div></td>
        <td style="${td}">${s.dials}</td>
        <td style="${td}">${pctTxt(s.connectRate)}</td>
        <td style="${td};font-weight:800;color:${s.booked ? '#15803d' : 'inherit'}">${s.booked}</td>
        <td style="${td}">${s.per100.toFixed(1)}</td>
        <td style="${td}">≥ ${s.low.toFixed(1)}</td>
        <td style="${td}">${s.underContract}</td>
        <td style="${td};color:${s.dqRate >= 0.4 && !early ? '#dc2626' : 'inherit'}">${pctTxt(s.dqRate)}</td>
        <td style="${td}">${s.dials ? pctTxt(s.notInterested / s.dials) : '—'}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ─── Manager: the per-client numbers again, per industry, with a keep / cut call ───
// The verdict asks one question: at the average booking rate across every industry, how likely is it that this
// industry would have booked this few meetings or fewer in this many dials? Under 10% = it is genuinely worse, cut it.
// Or the list doesn't fit: 0 meetings in CUT_MIN_DIALS+ dials with over half the properties disqualified at the desk.
const CUT_BELOW = 0.1;
const CUT_MIN_DIALS = 100, CUT_DQ = 0.5;
function binomCdf(k, n, p) {
  let term = Math.pow(1 - p, n), sum = term;
  for (let i = 1; i <= k; i++) { term *= (n - i + 1) / i * p / (1 - p); sum += term; }
  return Math.min(1, sum);
}
function industryVerdict(s, avg) {
  if (s.dials < MIN_DIALS) return { label: 'Too early', color: '#64748b', bg: '#f1f5f9', why: `Under ${MIN_DIALS} dials` };
  if (s.booked / s.dials >= avg) return { label: 'Keep', color: '#15803d', bg: '#dcfce7', why: 'Books at or above the average rate' };
  const expected = avg * s.dials;
  const chance = binomCdf(s.booked, s.dials, avg);
  const why = `${s.booked} booked in ${s.dials} dials; the average rate would give ${expected.toFixed(1)}. Chance it's just bad luck: ${Math.round(100 * chance)}%`;
  const misfit = !s.booked && s.dials >= CUT_MIN_DIALS && s.dqRate > CUT_DQ;
  if (chance < CUT_BELOW || misfit) {
    return { label: 'Cut', color: '#fff', bg: '#dc2626', why: misfit ? `0 meetings in ${s.dials} dials and ${Math.round(100 * s.dqRate)}% of properties disqualified at the desk: the list doesn't fit. ${why}` : why };
  }
  return { label: 'Watch', color: '#b45309', bg: '#fef3c7', why };
}
function industryVerdictTable() {
  const total = tally(cc.calls);
  const avg = total.dials ? total.booked / total.dials : 0;
  const segs = segmentRows(cc.calls, industryOf);
  if (!segs.length) return '<div style="font-size:12px;color:#94a3b8">No dials yet.</div>';
  const pctTxt = v => v == null ? '—' : v + '%';
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>
    <tr><th style="${th}" colspan="2"></th><th style="${th};border-left:1px solid #e2e8f0" colspan="4">This week</th><th style="${th};border-left:1px solid #e2e8f0" colspan="7">All dials</th></tr>
    <tr><th style="${th}">#</th><th style="${th}">Industry</th>
      <th style="${th};border-left:1px solid #e2e8f0">Dials</th><th style="${th}">Connections</th><th style="${th}">Connect %</th><th style="${th}">Meetings</th>
      <th style="${th};border-left:1px solid #e2e8f0">Dials</th><th style="${th}">Connections</th><th style="${th}">Connect %</th><th style="${th}">Meetings</th><th style="${th}">Dials / meeting</th><th style="${th}">Showed / no-show</th><th style="${th}">Verdict</th></tr></thead><tbody>
    ${segs.map((s, i) => {
      const rows = cc.calls.filter(r => industryOf(r) === s.name);
      const w = tally(rows, thisWeek());
      const a = tally(rows);
      const v = industryVerdict(s, avg);
      return `<tr>
        <td style="${td};font-weight:800">${i + 1}</td>
        <td style="${td}"><b>${esc(s.name)}</b><div style="font-size:10px;color:#94a3b8">${esc(s.clients.join(', '))}</div></td>
        <td style="${td};border-left:1px solid #e2e8f0">${w.dials}</td><td style="${td}">${w.connections}</td><td style="${td}">${pctTxt(w.connectRate)}</td><td style="${td};font-weight:700">${w.booked}</td>
        <td style="${td};border-left:1px solid #e2e8f0">${a.dials}</td><td style="${td}">${a.connections}</td><td style="${td}">${pctTxt(a.connectRate)}</td>
        <td style="${td};font-weight:800;color:${a.booked ? '#15803d' : 'inherit'}">${a.booked}</td>
        <td style="${td}">${a.booked ? Math.round(a.dials / a.booked) : '—'}</td>
        <td style="${td}">${a.showed} / ${a.noShow}</td>
        <td style="${td}"><span title="${esc(v.why)}" style="font-size:10px;font-weight:800;color:${v.color};background:${v.bg};padding:2px 8px;border-radius:8px;cursor:help;white-space:nowrap">${v.label}</span></td></tr>`;
    }).join('')}</tbody></table></div>
    <div style="font-size:11px;color:#94a3b8;margin-top:6px">Average across every industry: ${total.booked} meetings in ${total.dials} dials (1 per ${total.booked ? Math.round(total.dials / total.booked) : '—'}).
      <b>Cut</b> = it books so far below that average that bad luck explains it less than ${Math.round(100 * CUT_BELOW)}% of the time, or it has 0 meetings in ${CUT_MIN_DIALS}+ dials with over ${Math.round(100 * CUT_DQ)}% desk DQ (the properties aren't a fit). <b>Watch</b> = below average but too few dials to be sure. Hover a verdict for the numbers.</div>`;
}

/** The client panel's top section on the Cold Calling board: this week against the cap, and what has worked for them. */
export function clientColdCallStatsHtml(clientName) {
  const r = rankedClients().find(x => x.name === clientName);
  const mine = cc.calls.filter(x => x.client_name === clientName);
  const w = tally(mine, thisWeek());
  const a = tally(mine);
  const segs = segmentRows(mine, industryOf);
  const cap = r ? r.cap : (Number(cc.quotas.capPerClient) || 2);
  const box = (label, v) => `<div style="flex:1;min-width:90px"><div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase">${label}</div><div style="font-size:18px;font-weight:800;color:#0f172a">${v}</div></div>`;
  return `<div style="margin-bottom:16px;padding:12px;background:#f5f3ff;border-radius:8px;border:1px solid #ddd6fe">
    <div style="font-size:11px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Cold calling this week${r && r.unlocked ? ' · ' + UNLIMITED_BADGE : r && r.capped ? ' · <span style="color:#fff;background:#6b7280;padding:1px 6px;border-radius:8px;font-size:9px">CAPPED</span>' : r && r.lastSlot ? ' · ' + LAST_SLOT_BADGE : ''}</div>
    <div style="margin-bottom:10px">${r && r.unlocked ? capCell(r) : bar(w.booked, cap, { cap: true })}<div style="font-size:10px;color:#94a3b8;margin-top:2px">${r && r.unlimited ? `meetings this week / weekly cap (unlimited once every client has ${cap})` : 'meetings this week / weekly cap'}</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${box('Dials', w.dials)}${box('Connections', w.connections)}${box('Connect %', w.connectRate == null ? '—' : w.connectRate + '%')}${box('All-time meetings', `${a.booked}<span style="font-size:11px;color:#64748b;font-weight:600"> / ${a.dials} dials</span>`)}</div>
    ${segs.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Industry</th><th style="${th}">Dials</th><th style="${th}">Reached a person</th><th style="${th}">Meetings</th><th style="${th}">Desk DQ</th></tr></thead><tbody>
      ${segs.map(s => `<tr><td style="${td}">${esc(s.name)}</td><td style="${td}">${s.dials}</td><td style="${td}">${Math.round(100 * s.connectRate)}%</td><td style="${td};font-weight:700;color:${s.booked ? '#15803d' : 'inherit'}">${s.booked}</td><td style="${td}">${Math.round(100 * s.dqRate)}%</td></tr>`).join('')}
    </tbody></table>` : '<div style="font-size:12px;color:#94a3b8">No dials for this client yet.</div>'}
  </div>`;
}

function industriesHtml() {
  const f = cc.industryFilter || { days: 0, client: '' };
  const since = f.days ? new Date(Date.now() - f.days * 864e5).toISOString().slice(0, 10) : '';
  const rows = cc.calls.filter(r => (!since || r.call_date >= since) && (!f.client || r.client_name === f.client));
  const clients = [...new Set(cc.calls.map(r => r.client_name).filter(Boolean))].sort();
  const controls = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <select data-action="ccIndustryDays" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px">
      ${[[0, 'All dials'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([d, l]) => `<option value="${d}" ${f.days === d ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <select data-action="ccIndustryClient" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px">
      <option value="">All clients</option>${clients.map(n => `<option value="${esc(n)}" ${f.client === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <span style="font-size:11px;color:#94a3b8">${rows.length} dials</span></div>`;
  const how = `<div style="font-size:11px;color:#94a3b8;margin-top:8px">Ranked on meetings per 100 dials, using the cautious end of the range (95% lower bound), so a lucky small sample can't outrank a proven one. Ties go to more under-contract calls, then more dials that reached a person, then fewer desk DQs. Segments under ${MIN_DIALS} dials are greyed and listed last: too early to judge. Industry = as the fulfillment dashboard names it: the lead list the dialed phone was built from (a phone in no fulfillment list uses the JustCall list's name); property type = read from the property's name (a name with no telling word takes its list's segment).</div>`;
  const ind = segmentRows(rows, industryOf);
  const prop = segmentRows(rows, r => r.property_type);
  const best = ind.find(s => s.dials >= MIN_DIALS && s.booked);
  return section('Industries ranked by meetings booked', controls +
      (best ? `<div style="font-size:12px;color:#334155;margin-bottom:10px">Best so far: <b>${esc(best.name)}</b>, ${best.booked} meeting${best.booked === 1 ? '' : 's'} in ${best.dials} dials (${best.per100.toFixed(1)} per 100).</div>` : '') +
      (ind.length ? rankingTable(ind, 'Industry') : '<div style="font-size:12px;color:#94a3b8">No dials yet.</div>') + how)
    + section('Property types ranked by meetings booked', prop.length ? rankingTable(prop, 'Property type') : '<div style="font-size:12px;color:#94a3b8">No dials yet.</div>');
}

// ─── Feedback: the caller's notes on lists, for whoever builds them ───
const FEEDBACK_KINDS = ['Wrong property type', 'Outside service area', 'Bad / wrong numbers', 'Segment that works', 'Idea for a list', 'Other'];

async function loadFeedback() {
  if (cc.feedbackLoading) return;
  cc.feedbackLoading = true;
  const { data, error } = await supabase.from('cold_call_feedback').select('*').order('created_at', { ascending: false }).limit(500);
  cc.feedback = error ? { error: error.message } : (data || []);
  cc.feedbackLoading = false;
  render();
}

function feedbackHtml() {
  if (!cc.feedback && !cc.feedbackLoading) loadFeedback();
  const clients = coldCallClients().map(c => c.name).sort();
  const lists = [...new Set(cc.calls.map(r => r.campaign_name).filter(Boolean))].sort();
  const industries = [...new Set(cc.calls.map(industryOf))].filter(i => i !== 'Unclassified').sort();
  const sel = (id, opts, blank) => `<select id="${id}" style="padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;max-width:240px"><option value="">${blank}</option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
  const form = section('Give feedback on a list', `<div style="font-size:12px;color:#475569;margin-bottom:8px">Anything about the lists you're calling: wrong kinds of properties, bad numbers, what's working, an idea for the next list. It goes to whoever builds the lists, and you'll see here when it's been dealt with.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${sel('ccfb-kind', FEEDBACK_KINDS, 'What kind of feedback?')}
      ${sel('ccfb-client', clients, 'Client (optional)')}
      ${sel('ccfb-list', lists, 'List (optional)')}
      ${sel('ccfb-industry', industries, 'Industry (optional)')}
    </div>
    <textarea id="ccfb-note" rows="3" placeholder="e.g. Most of this list are stores inside a bigger building. They don't control the landscaping." style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);margin-bottom:8px"></textarea>
    <button class="btn btn-primary" data-action="ccFeedbackSubmit" style="font-size:12px">Send feedback</button>`);
  if (!cc.feedback || cc.feedbackLoading) return form + section('Feedback', '<div style="font-size:12px;color:#94a3b8">Loading…</div>');
  if (cc.feedback.error) return form + section('Feedback', `<div style="font-size:12px;color:#dc2626">${esc(cc.feedback.error)}</div>`);
  const open = cc.feedback.filter(f => f.status === 'open');
  const closed = cc.feedback.filter(f => f.status !== 'open');
  const item = f => {
    const meta = [f.client_name, f.campaign_name, f.industry].filter(Boolean).map(esc).join(' · ');
    const fromCall = /^call (\d{4}-\d{2}-\d{2})/.exec(f.source || '');
    const when = new Date(fromCall ? fromCall[1] + 'T12:00:00' : f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (fromCall ? ' call' : '');
    const closedTxt = f.status === 'done' ? 'Done' : "Won't do";
    return `<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div><span style="font-size:10px;font-weight:700;background:#f3e8ff;color:#7c3aed;padding:2px 7px;border-radius:8px">${esc(f.kind)}</span>
          ${meta ? `<span style="font-size:11px;color:#64748b;margin-left:6px">${meta}</span>` : ''}</div>
        <span style="font-size:11px;color:#94a3b8;white-space:nowrap">${esc(f.author_name || f.author_email || '')} · ${esc(when)}</span>
      </div>
      <div style="font-size:12px;color:#0f172a;margin-top:6px;white-space:pre-wrap">${esc(f.note)}</div>
      ${f.status !== 'open' ? `<div style="font-size:11px;margin-top:6px;color:${f.status === 'done' ? '#15803d' : '#64748b'}"><b>${closedTxt}</b>${f.resolution ? ': ' + esc(f.resolution) : ''}${f.resolved_by ? ' (' + esc(f.resolved_by) + ')' : ''}</div>`
        : !isSdr() ? `<div style="display:flex;gap:6px;margin-top:8px">
          <input id="ccfb-res-${esc(f.id)}" placeholder="What changed (shown to the caller)" style="flex:1;padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px">
          <button data-action="ccFeedbackResolve" data-id="${esc(f.id)}" data-status="done" style="font-size:11px;padding:4px 10px;border:1px solid #16a34a;background:#dcfce7;color:#15803d;border-radius:6px;cursor:pointer;font-weight:600">Done</button>
          <button data-action="ccFeedbackResolve" data-id="${esc(f.id)}" data-status="wont_do" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);background:#fff;color:#64748b;border-radius:6px;cursor:pointer;font-weight:600">Won't do</button></div>`
        : '<div style="font-size:11px;color:#b45309;margin-top:6px">Open</div>'}
    </div>`;
  };
  return form + section(`Open (${open.length})`, open.length ? open.map(item).join('') : '<div style="font-size:12px;color:#94a3b8">Nothing open.</div>')
    + (closed.length ? section(`Dealt with (${closed.length})`, closed.map(item).join('')) : '');
}

// ─── Sub-tab dispatcher (everything except the Pipeline board, which render.js draws) ───
export function renderColdCallingView() {
  const sub = state.coldCallSubTab || 'queue';
  let body;
  if (!cc.loaded) body = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading cold calls…</div>';
  else if (cc.error) body = section('Couldn\'t load the call log', `<div style="font-size:12px;color:#dc2626">${esc(cc.error)}</div>`);
  else if (sub === 'tracker') body = trackerHtml();
  else if (sub === 'manager' && !isSdr()) body = managerHtml();
  else if (sub === 'industries') body = industriesHtml();
  else if (sub === 'feedback') body = feedbackHtml();
  else body = queueHtml();
  return `<div style="padding:4px 20px 40px;max-width:1200px;margin:0 auto">${body}</div>`;
}

// ─── Deal card: every dial to this lead, with recording and transcript ───
export function coldCallHistoryHtml(deal) {
  const phones = [deal.phone, deal.mobilePhone, deal.phone2, deal.phone3]
    .map(p => { const d = str(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; }).filter(Boolean);
  if (!phones.length || (deal.leadSource !== 'cold_call' && deal.stage !== CALLBACK_STAGE)) return '';
  const key = deal.id + '|' + phones.join(',');
  if (!_history.has(key)) {
    _history.set(key, '<div style="font-size:12px;color:#94a3b8">Loading calls…</div>');
    supabase.from('cold_calls').select('call_id,called_at,agent_name,agent_email,disposition,outcome,duration_sec,notes,recording_url,transcript,transcript_status,campaign_name,booked_on,not_counted')
      .in('phone10', phones).order('called_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        _history.set(key, error ? `<div style="font-size:12px;color:#dc2626">${esc(error.message)}</div>` : historyRows(data || []));
        const el = document.getElementById('cc-history-' + deal.id);
        if (el) el.innerHTML = _history.get(key);
      });
  }
  return `<div class="form-group form-span2" style="margin:12px 0 8px 0;padding:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
    <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:8px">${svgIcon('phone', 12, '#0369a1')} Cold calls to this lead</div>
    <div id="cc-history-${esc(deal.id)}">${_history.get(key)}</div>${removeBookingButton(deal)}</div>`;
}

// ─── Remove a cold-call lead and its appointment (asked for 2026-11-12) ───
// A booked meeting that falls through (wrong person, cancelled, not a real appointment) used to need Tim to
// clear it by hand. One button on the card does both halves:
//   1. cold_calls.not_counted = the reason on this deal's dials, so the meeting leaves the client's weekly cap
//      (Call Queue reopens the client), the rep's numbers and "My bookings" (isMeeting skips not_counted).
//   2. archives the card with the reason (deleteDeal): it leaves the board and "All booked meetings", and
//      push-lead-tracker drops it from the client's sheet if it was already sent there.
// Managers and staff only: SDRs can read cold_calls but not write them (sdr RLS).
function removeBookingButton(deal) {
  if (!(isAdmin() || isEmployee()) || isSdr() || deal.pipeline !== 'Client') return '';
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #bae6fd">
    <button onclick="event.stopPropagation();ccRemoveBooking(${jsArg(deal.id)})" title="Archive this lead and stop its meeting counting toward the client's weekly cap and the tracker"
      style="padding:7px 14px;background:#fff;color:#b91c1c;border:1px solid #fca5a5;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">
      Remove lead + its appointment</button></div>`;
}

// Inline handler: the deal modal stops click propagation, so body-level data-action delegation never sees it.
window.ccRemoveBooking = (dealId) => removeBooking(dealId);

async function removeBooking(dealId) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  const reason = (prompt(`Remove ${deal.company || deal.contact || 'this lead'} and its appointment?\n\nIt leaves the board and the lead tracker, and its meeting stops counting toward ${deal.stage}'s weekly cap.\n\nWhy? (e.g. cancelled, wrong contact, not a real appointment)`) || '').trim();
  if (!reason) return;
  const who = (currentUser && currentUser.email) || 'CRM';
  // 1. Un-count the meeting first: if this fails nothing is archived, so the card is still there to retry.
  const { data: rows, error } = await supabase.from('cold_calls')
    .update({ not_counted: `Removed: ${reason} · ${who} · ${getToday()}` }).eq('deal_id', dealId).select('call_id');
  if (error) { alert('Could not update the meeting count, nothing was removed: ' + error.message); return; }
  for (const r of cc.calls || []) if (r.deal_id === dealId) r.not_counted = 'Removed: ' + reason;
  const [{ sbCreateInteraction }, { deleteDeal }] = await Promise.all([
    import('./api.js?v=20261114162507'), import('./deals.js?v=20261114162507')]);
  try { await sbCreateInteraction({ deal_id: dealId, type: 'Note', content: `Removed — cold-call appointment: ${reason} · ${(rows || []).length} dial(s) no longer counted · marked in the CRM` }); }
  catch (e) { console.warn('[removeBooking] note not saved', e && e.message); }
  await deleteDeal(dealId, 'Removed — ' + reason);
  cc.tracker = null; // rebuild "All booked meetings" on the next view
  render();
}

function historyRows(calls) {
  if (!calls.length) return '<div style="font-size:12px;color:#94a3b8">No Sales Dialer calls to this number yet.</div>';
  return calls.map(c => {
    const when = c.called_at ? new Date(c.called_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const tx = str(c.transcript).trim();
    return `<div style="border-top:1px solid #e0f2fe;padding:8px 0">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
        <span><b>${esc(OUTCOME_LABEL[c.outcome] || c.disposition || 'Call')}</b>${c.booked_on ? ` · <b style="color:#15803d">meeting booked ${esc(c.booked_on)}</b>` : ''}${c.not_counted ? ` · <span style="color:#94a3b8" title="${esc(c.not_counted)}">not counted</span>` : ''} · ${esc(c.agent_name || c.agent_email || '')} · ${Math.round((c.duration_sec || 0) / 60 * 10) / 10} min</span>
        <span style="color:#64748b;white-space:nowrap">${esc(when)}</span></div>
      ${c.notes ? `<div style="font-size:12px;color:#334155;margin-top:3px">Notes: ${esc(c.notes)}</div>` : ''}
      ${c.recording_url ? `<audio controls preload="none" src="${esc(c.recording_url)}" style="width:100%;height:32px;margin-top:6px"></audio>` : '<div style="font-size:11px;color:#94a3b8">No recording</div>'}
      ${tx ? `<details style="margin-top:4px"><summary style="font-size:11px;font-weight:600;color:#0369a1;cursor:pointer">Transcript</summary><div style="white-space:pre-wrap;font-size:11px;max-height:260px;overflow:auto;background:#fff;border-radius:6px;padding:8px;margin-top:4px">${esc(tx)}</div></details>`
        : c.recording_url && (c.duration_sec || 0) >= 15 ? `<button class="btn btn-ghost" data-action="ccTranscribe" data-id="${c.call_id}" style="font-size:11px;padding:3px 10px;margin-top:4px">${c.transcript_status === 'pending' ? 'Transcribing…' : c.transcript_status === 'unavailable' ? 'Transcription not switched on' : 'Transcribe'}</button>` : ''}
    </div>`;
  }).join('');
}

// ─── Actions ───
registerActions({
  ccSubTab(el) {
    state.coldCallSubTab = el.dataset.tab;
    location.hash = 'cold_calling' + (el.dataset.tab === 'queue' ? '' : '/' + el.dataset.tab);
    if (el.dataset.tab === 'tracker') cc.tracker = null; // fresh on every visit
    if (el.dataset.tab === 'feedback') cc.feedback = null;
    render();
  },
  ccToggleAllLeads() { state.ccAllLeads = !state.ccAllLeads; render(); },
  ccIndustryDays(el, e) { if (e.type !== 'change') return; cc.industryFilter = { ...(cc.industryFilter || { client: '' }), days: Number(el.value) }; render(); },
  ccIndustryClient(el, e) { if (e.type !== 'change') return; cc.industryFilter = { ...(cc.industryFilter || { days: 0 }), client: el.value }; render(); },
  async ccFeedbackSubmit(el) {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const note = val('ccfb-note'), kind = val('ccfb-kind');
    if (!kind) { alert('Pick what kind of feedback it is.'); return; }
    if (!note) { alert('Write what you noticed.'); return; }
    el.disabled = true; el.textContent = 'Sending…';
    const { error } = await supabase.from('cold_call_feedback').insert({
      kind, note, client_name: val('ccfb-client') || null, campaign_name: val('ccfb-list') || null, industry: val('ccfb-industry') || null,
      author_email: (currentUser && currentUser.email || '').toLowerCase(), author_name: currentUser && currentUser.name, source: 'crm',
    });
    if (error) { alert('Could not send: ' + error.message); el.disabled = false; el.textContent = 'Send feedback'; return; }
    cc.feedback = null; render();
  },
  async ccFeedbackResolve(el) {
    const id = el.dataset.id;
    const resolution = (document.getElementById('ccfb-res-' + id)?.value || '').trim() || null;
    const { error } = await supabase.from('cold_call_feedback').update({
      status: el.dataset.status, resolution, resolved_by: currentUser && currentUser.name, resolved_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return; }
    cc.feedback = null; render();
  },
  async ccSync() {
    cc.syncing = true; cc.syncNote = ''; render();
    try {
      const { invokeEdgeFunctionAsUser } = await import('./edge-auth.js?v=20261114162507');
      const out = await invokeEdgeFunctionAsUser('cold-call-sync', {});
      // One sync at a time (audit A3 #4, 2026-11-13): a Refresh during the 2-minute cron's run is skipped.
      if (out.skipped) {
        cc.syncNote = 'A sync is already running — showing its results';
      } else {
        const made = (out.cards || []).filter(c => c.created).length;
        cc.syncNote = `${out.synced} dials pulled${made ? `, ${made} new card${made === 1 ? '' : 's'}` : ''}`;
      }
      await loadAll();
    } catch (e) {
      cc.syncNote = 'Refresh failed: ' + e.message;
    } finally {
      cc.syncing = false; render();
    }
  },
  ccOpenDeal(el) {
    const id = el.dataset.id;
    if (!state.deals.some(d => String(d.id) === String(id))) { alert('That card is no longer on the board (delivered or archived).'); return; }
    import('./deal-modal.js?v=20261114162507').then(m => m.openDeal(id));
  },
  ccTrackerScope(el) { cc.trackerScope = el.dataset.scope; render(); },
  ccTrackerClient(el, e) { if (e.type !== 'change') return; cc.trackerClient = el.value; render(); },
  ccTrackerSearch(el, e) { if (e.type !== 'input') return; cc.trackerSearch = el.value; render(); },
  async ccPin(el) {
    const name = el.dataset.name;
    const pinning = !cc.pinned.includes(name);
    cc.pinned = pinning ? [...cc.pinned, name] : cc.pinned.filter(n => n !== name);
    // With a dragged order in place, pinning moves the client to the top of it.
    if (pinning && cc.order.length) cc.order = [name, ...cc.order.filter(n => n !== name)];
    render();
    await saveSetting('cold_call_pinned', cc.pinned);
    if (pinning && cc.order.length) await saveSetting('cold_call_order', cc.order);
  },
  async ccSnow(el) {
    const name = el.dataset.name;
    const sn = snowFor(name);
    const by = currentUser && currentUser.name || '';
    if (sn.active) {
      // Off until the storm window would have closed (or a week, for a manual switch-on).
      const until = sn.storm ? addDays(sn.storm.end, SNOW_AFTER_DAYS) : addDays(today(), 7);
      cc.snowManual = { ...cc.snowManual, [name]: { mode: 'off', until, by } };
    } else {
      cc.snowManual = { ...cc.snowManual, [name]: { mode: 'on', until: addDays(today(), SNOW_MANUAL_DAYS - 1), by } };
    }
    for (const [k, v] of Object.entries(cc.snowManual)) if (!v || v.until < today()) delete cc.snowManual[k];
    render();
    await saveSetting('cold_call_snow_manual', cc.snowManual);
  },
  async ccResetOrder() {
    cc.order = [];
    render();
    await saveSetting('cold_call_order', []);
  },
  async ccUnlimited(el) {
    const name = el.dataset.name;
    cc.unlimited = cc.unlimited.includes(name) ? cc.unlimited.filter(n => n !== name) : [...cc.unlimited, name];
    render();
    await saveSetting('cold_call_unlimited', cc.unlimited);
  },
  async ccShow(el) {
    const id = Number(el.dataset.id);
    const row = cc.calls.find(r => r.call_id === id);
    const next = row && row.show_status === el.dataset.status ? null : el.dataset.status; // click again to clear
    if (row) row.show_status = next;
    render();
    const { error } = await supabase.from('cold_calls').update({ show_status: next }).eq('call_id', id);
    if (error) alert('Could not save: ' + error.message);
  },
  async ccSaveQuotas() {
    const q = {};
    for (const k of Object.keys(DEFAULT_QUOTAS)) q[k] = Math.max(0, Number(document.getElementById('ccq-' + k)?.value) || 0);
    cc.quotas = q;
    render();
    await saveSetting('cold_call_quotas', q);
  },
  async ccToggleClient(el, e) {
    if (e.type !== 'change') return;
    const c = state.clients.find(x => String(x.id) === el.dataset.id);
    if (!c) return;
    c.coldCalling = el.checked ? 'true' : 'false';
    render();
    const { error } = await supabase.from('clients').update({ cold_calling: el.checked }).eq('id', c.id);
    if (error) alert('Could not save: ' + error.message);
  },
  async ccTranscribe(el) {
    el.disabled = true; el.textContent = 'Transcribing…';
    try {
      const { invokeEdgeFunctionAsUser } = await import('./edge-auth.js?v=20261114162507');
      const out = await invokeEdgeFunctionAsUser('cold-call-sync', { action: 'transcribe', call_id: Number(el.dataset.id) });
      const box = document.createElement('div');
      box.style.cssText = 'white-space:pre-wrap;font-size:11px;max-height:260px;overflow:auto;background:#fff;border-radius:6px;padding:8px;margin-top:4px';
      box.textContent = out.transcript || '';
      el.replaceWith(box);
      _history.clear();
    } catch (e) {
      el.textContent = e.message.includes('not switched on') ? 'Transcription not switched on' : 'Transcribe failed';
      el.title = e.message;
    }
  },
});

// ─── Manager: drag a client row to reorder the call queue ───
// The delegate only routes click/change/input, so the drag events are wired here once.
let _dragName = null;
function _ccRow(e) { return e.target && e.target.closest ? e.target.closest('tr[data-cc-row]') : null; }
function _clearDropMarks() {
  document.querySelectorAll('tr[data-cc-row]').forEach(tr => { tr.style.boxShadow = ''; tr.style.opacity = ''; });
}
function _dropAfter(tr, e) { const b = tr.getBoundingClientRect(); return e.clientY > b.top + b.height / 2; }
if (typeof document !== 'undefined' && !window.__ccDragWired) {
  window.__ccDragWired = true;
  document.addEventListener('dragstart', e => {
    const tr = _ccRow(e);
    if (!tr) return;
    _dragName = tr.dataset.ccRow;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', _dragName); } catch (_) { /* some browsers need data to start a drag */ }
    tr.style.opacity = '.4';
  });
  document.addEventListener('dragover', e => {
    if (!_dragName) return;
    const tr = _ccRow(e);
    if (!tr) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('tr[data-cc-row]').forEach(x => { if (x !== tr) x.style.boxShadow = ''; });
    tr.style.boxShadow = _dropAfter(tr, e) ? 'inset 0 -3px 0 var(--purple)' : 'inset 0 3px 0 var(--purple)';
  });
  document.addEventListener('drop', async e => {
    if (!_dragName) return;
    const tr = _ccRow(e);
    const from = _dragName;
    _dragName = null;
    _clearDropMarks();
    if (!tr || tr.dataset.ccRow === from) return;
    e.preventDefault();
    const names = rankedClients().map(r => r.name).filter(n => n !== from);
    const at = names.indexOf(tr.dataset.ccRow) + (_dropAfter(tr, e) ? 1 : 0);
    names.splice(at, 0, from);
    cc.order = names;
    render();
    await saveSetting('cold_call_order', names);
  });
  document.addEventListener('dragend', () => { if (_dragName) { _dragName = null; _clearDropMarks(); } });
}
