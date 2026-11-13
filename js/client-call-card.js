// ═══════════════════════════════════════════════════════════
// CLIENT-CALL-CARD — the client panel on the Cold Calling board, as tabs
// ═══════════════════════════════════════════════════════════
//
// Ioannis, 2026-11-04: the call sheet (Google Doc) and the client card were two places to look, and finding an
// answer mid-call meant scrolling. So on the Cold Calling board the card IS the call sheet, one tab per thing a
// caller looks for: Map, Services, Properties, Questions, Quick lines, Who we want, Client info, Appointments,
// Calendar, Cold calling. Every call sheet field (clients.call_*) shows here and edits in place; an edit rebuilds the doc
// within a minute (the clients trigger), so the doc stays in step for anyone still using it.
//
// client-panel.js owns the overlay and the editable blocks; this module only lays them out in tabs and owns the
// Appointments tab. The panel is never re-rendered while open, so switching tabs only flips which pane shows.

import { state } from './app.js?v=20261114001316';
import { esc, str, svgIcon, getToday } from './utils.js?v=20261114001316';
import { supabase } from './supabase-client.js?v=20261114001316';
import { registerActions } from './delegate.js?v=20261114001316';
import { clientIanaTz, setCalendlyBookingDealId } from './calendly.js?v=20261114001316';

// ─── Call sheet fields (clients.call_*: no FIELD_MAP entry, so snake_case on the client object) ───
const lineList = v => {
  const l = str(v).split('\n').map(x => x.trim()).filter(Boolean);
  return l.length ? (l.length === 1 ? esc(l[0]) : '<ul style="margin:0;padding-left:18px">' + l.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>') : '';
};
const field = (label, placeholder, multiline = false) => ({
  label, column: null, multiline, placeholder,
  toText: v => str(v),
  toValue: text => text.replace(/\n{3,}/g, '\n\n').trim(),
  view: multiline ? lineList : v => esc(str(v).trim()),
});
const CALL_FIELD_DEFS = {
  call_display_name: field('Company name to say', 'Blank = the CRM name without LLC / Inc.'),
  call_meets_lead: field('Meets them (who meets the lead)', 'e.g. Jerry Grzan, Owner (he does the walk-through himself)'),
  call_shop: field('Shop (where they are based)', 'e.g. Buford, GA. Blank = Home Base'),
  call_caller_id: field('Caller ID', 'JustCall number we dial from'),
  call_booking_notes: field('Booking notes', 'One per line', true),
  call_coverage: field('Covers (service area in words)', 'Further lines print under it, e.g. a separate snow area', true),
  call_min_job_size: field('Size (minimum job)', 'e.g. nothing under about $1,000/month'),
  call_areas_avoid: field('Not in area', 'e.g. Kennesaw or anything west of Marietta', true),
  call_property_types_want: field('Who we want', 'e.g. HOAs · apartments · office parks', true),
  call_property_types_avoid: field('Do NOT pitch', 'e.g. single-family homes · one-off small jobs', true),
  call_do_not_call: field('Do NOT call (named companies)', 'Current customers or open deals we must never call', true),
  call_reference_note: field('Note under the properties', 'e.g. 79 accounts in total (Mike\'s list)', true),
  call_services_not: field('Not (services they don\'t do)', 'e.g. tree work over 12 ft'),
  call_quick_lines: field('Quick lines', 'One selling point per line', true),
  call_get_extra: field('Extra to get before hanging up', 'One per line. A line starting like a standard item replaces it.', true),
  call_confirmation_email: field('Confirmation email', 'The email sent after booking. One paragraph per line.', true),
};
/** Merged into client-panel's EDITABLE so the same Edit / autosave / Done flow handles them. */
export const CALL_FIELDS = Object.fromEntries(Object.entries(CALL_FIELD_DEFS).map(([k, f]) => [k, { ...f, column: k }]));

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'services', label: 'Services' },
  { id: 'properties', label: 'Properties' },
  { id: 'questions', label: 'Questions' },
  { id: 'quick', label: 'Quick lines' },
  { id: 'want', label: 'Who we want' },
  { id: 'info', label: 'Client info' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'cold', label: 'Cold calling' },
];
let _tab = 'map';          // remembered between opens, so the caller lands where they left off
let _onShow = {};          // pane id → run once the first time it shows (the map needs a visible box)
let _client = null;

// ─── What the call sheet prints that is not a field ───
const CALLER = 'Sean';
function displayName(c) {
  return str(c.call_display_name).trim() || str(c.name).replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|LTD|Corp\.?)$/i, '').trim();
}
/** Same list as the call sheet's "Get before hanging up" (call-sheet-render.ts). */
function getBeforeHangingUp(c) {
  const who = (str(c.call_meets_lead).match(/^[A-Za-z][\w'.-]*/) || [])[0] || displayName(c);
  const head = ['Name + title', 'property address', 'email', 'cell'];
  const tail = ['meet on site'];
  const added = [];
  for (const x of str(c.call_get_extra).split('\n').map(l => l.trim()).filter(Boolean)) {
    const std = [head, tail].find(list => list.some(i => x.toLowerCase().startsWith(i.toLowerCase())));
    if (std) std[std.findIndex(i => x.toLowerCase().startsWith(i.toLowerCase()))] = x;
    else added.push(x);
  }
  return [...head, ...added, ...tail, `best day/time for ${who}`];
}

const box = (inner, tone = {}) => `<div style="margin-bottom:16px;padding:12px;background:${tone.bg || '#f8fafc'};border-radius:8px;border:1px solid ${tone.border || '#e2e8f0'}">${inner}</div>`;
const heading = (t, color = '#64748b') => `<div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${t}</div>`;
const fact = (label, value) => `<div style="font-size:13px;color:#334155;margin-bottom:4px"><b>${esc(label)}:</b> ${value}</div>`;

/**
 * The tabbed body. `parts` comes from client-panel.js: editable(field, opts), questions, contact, stats, map,
 * coldCalls, callSheetLink, serviceAreaLink, billing (the calendar has its own Calendar tab) (HTML strings or a function for editable blocks).
 */
export function callCardHtml(cl, parts) {
  _client = cl.name;
  _onShow = {};
  const ed = parts.editable;
  const blue = { tone: { wrap: 'padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe', label: '#1e40af', text: '#1e3a5f' } };
  const red = { tone: { wrap: 'padding:12px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca', label: '#b91c1c' } };
  const green = { tone: { wrap: 'padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0', label: '#166534' } };
  const teal = { tone: { wrap: 'padding:12px;background:#f0fdfa;border-radius:8px;border:1px solid #99f6e4', label: '#0f766e' } };

  const panes = {
    map: parts.map + ed('call_coverage', cl, blue) + ed('serviceAreaCities', cl) + ed('call_areas_avoid', cl, red) + parts.serviceAreaLink,
    services: ed('services', cl, green) + ed('call_services_not', cl, red),
    properties: ed('managedProperties', cl, teal) + ed('call_reference_note', cl),
    questions: parts.questions,
    quick: ed('call_quick_lines', cl, green) + ed('warmCallNotesText', cl),
    want: ed('call_property_types_want', cl, green) + ed('call_property_types_avoid', cl, red) + ed('call_min_job_size', cl) + ed('call_do_not_call', cl, red),
    info: box(heading('On the call') + fact('You are', esc(`${CALLER}, ${displayName(cl)}`))
        + fact('Get before hanging up', esc(getBeforeHangingUp(cl).join(' · '))))
      + ed('call_booking_notes', cl)
      + ed('call_display_name', cl) + ed('call_meets_lead', cl) + ed('call_shop', cl) + ed('location', cl) + '<div id="cp-loc-hint" style="margin:-12px 0 16px"></div>'
      + ed('call_caller_id', cl) + ed('call_get_extra', cl) + ed('call_confirmation_email', cl)
      + parts.contact + parts.callSheetLink + parts.billing,
    appointments: `<div id="cp-appts"><div style="font-size:12px;color:#94a3b8">Loading appointments…</div></div>`,
    // Ioannis, 2026-11-12: the open calendar gets its own tab, with nothing else in it.
    calendar: calendarHtml(cl),
    cold: parts.stats + parts.coldCalls,
  };
  if (!TABS.some(t => t.id === _tab)) _tab = 'map';
  const pill = 'padding:5px 11px;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;border-radius:6px';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:-6px 0 14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff;z-index:2;padding-top:6px">
      ${TABS.map(t => `<button data-action="cpTab" data-tab="${t.id}" id="cp-tabbtn-${t.id}" style="${pill};background:${t.id === _tab ? 'var(--purple)' : '#f3f4f6'};color:${t.id === _tab ? '#fff' : 'var(--text-muted)'}">${t.label}</button>`).join('')}
    </div>
    ${TABS.map(t => `<div data-cp-pane="${t.id}" ${t.id === _tab ? '' : 'hidden'}>${panes[t.id]}</div>`).join('')}`;
}

/** After the panel is in the DOM: the map draws when its pane first shows; the appointments load now. */
export function onCallCardOpen(clientName, { renderMap }) {
  if (renderMap) _onShow.map = renderMap;
  const cl = state.clients.find(c => c.name === clientName);
  // Re-count the client's meetings before the calendar shows when it is one short of its weekly cap, so two SDRs
  // can't both book the last slot (audit A3#6, round 2 C, Tim 2026-11-13). At the cap the calendar stays closed.
  if (cl && str(cl.calendlyUrl).trim()) _onShow.calendar = async () => {
    const c = window.ccCheckSlotBeforeBooking ? await window.ccCheckSlotBeforeBooking(clientName).catch(() => null) : null;
    if (c && c.ok === false) { const h = _client === clientName && document.getElementById('cp-cal'); if (h) h.innerHTML = `<div style="font-size:13px;color:#b91c1c;font-weight:600">${esc(c.message || 'This client is at its weekly cap.')}</div>`; return; }
    if (c && c.lastSlot && c.message) showLastSlotNote(clientName, c.message);
    mountCalendar(clientName, cl.calendlyUrl);
  };
  runOnShow(_tab);
  loadAppointments(clientName);
}

function runOnShow(id) {
  const fn = _onShow[id];
  if (fn) { delete _onShow[id]; setTimeout(fn, 0); }
}

export function showPane(id) {
  if (!document.querySelector(`[data-cp-pane="${id}"]`)) return;
  _tab = id;
  document.querySelectorAll('[data-cp-pane]').forEach(p => { p.hidden = p.dataset.cpPane !== id; });
  for (const t of TABS) {
    const b = document.getElementById('cp-tabbtn-' + t.id);
    if (b) { b.style.background = t.id === id ? 'var(--purple)' : '#f3f4f6'; b.style.color = t.id === id ? '#fff' : 'var(--text-muted)'; }
  }
  runOnShow(id);
}

// ─── Appointments: every meeting booked for this client, from the lead tracker, pass-offs and the board ───
/** "11/6/26", "2026-11-06", "2026-11-06T…" → "2026-11-06"; anything else → "". */
function isoDate(v) {
  const s = str(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "14:00:00", "2:00 PM", "Tuesday, November 10, 10:30 AM" → "2:00 PM" / "10:30 AM"; no clock time → "". */
function fmtTime(v) {
  const m = str(v).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?\s*[Mm]?\b/);
  if (!m) return '';
  let h = +m[1];
  const ap = m[3] ? m[3].toUpperCase() + 'M' : (h >= 12 ? 'PM' : 'AM');
  if (!m[3]) h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
/** "10:30 AM" → minutes after midnight, for sorting ("" sorts first). */
function timeMins(t) {
  const m = str(t).match(/^(\d{1,2}):(\d{2}) ([AP])M$/);
  return m ? ((+m[1] % 12) + (m[3] === 'P' ? 12 : 0)) * 60 + +m[2] : -1;
}

// Read through the client_appointments RPC, not the tables: an SDR's row access stops at cold-call deals, but a
// caller has to see every meeting booked for the client (email ones too) so a property is never booked twice.
async function loadAppointments(clientName) {
  try {
    const { data, error } = await supabase.rpc('client_appointments', { p_client: clientName });
    if (error) throw error;
    const rows = [];
    const seen = new Map();
    const key = r => str(r.lead).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) + '|' + r.appt;
    // Deal-linked rows first, so a CRM mirror row ("Booked in CRM", no deal id) only shows when nothing else does.
    for (const r of (data || []).sort((a, b) => (a.deal_id ? 0 : 1) - (b.deal_id ? 0 : 1))) {
      const row = { lead: r.lead, booked: isoDate(r.booked), appt: isoDate(r.appt_date), time: fmtTime(r.appt_time), source: r.source, dealId: r.deal_id };
      const k = key(row);
      // The tracker sometimes holds only the day ("Thursday, October 15"): take the time from the same meeting's other row.
      if (row.appt && seen.has(k)) { const first = seen.get(k); if (!first.time && row.time) first.time = row.time; continue; }
      seen.set(k, row);
      rows.push(row);
    }
    fillAppointments(clientName, rows);
  } catch (e) {
    const host = _client === clientName && document.getElementById('cp-appts');
    const msg = `<div style="font-size:12px;color:#dc2626">Couldn't load appointments: ${esc(e.message || String(e))}</div>`;
    if (host) host.innerHTML = msg;
    const calHost = _client === clientName && document.getElementById('cp-cal-upcoming');
    if (calHost) calHost.innerHTML = msg;
  }
}

// ─── The client's Calendly, open inline on the Calendar tab ───
// Tim 2026-11-14: the Upcoming card sits above the calendar too, so the caller sees what is already booked
// (date + time) while picking a slot.
function calendarHtml(cl) {
  const upcoming = `<div id="cp-cal-upcoming"><div style="font-size:12px;color:#94a3b8;margin-bottom:16px">Loading upcoming meetings…</div></div>`;
  if (!str(cl.calendlyUrl).trim()) return upcoming + box(heading('Calendar') + '<div style="font-size:12px;color:#94a3b8">No Calendly link for this client yet.</div>');
  return upcoming + box(heading(`${svgIcon('calendar', 12)} ${esc(cl.name)}'s calendar`, '#4338ca')
    + `<div id="cp-cal" style="min-width:280px;height:700px"></div>`, { bg: '#eef2ff', border: '#c7d2fe' });
}

function showLastSlotNote(clientName, msg) {
  const host = _client === clientName && document.getElementById('cp-cal');
  if (host && host.parentElement) host.insertAdjacentHTML('beforebegin', `<div style="margin-bottom:8px;padding:8px 10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:12px;font-weight:700;color:#92400e">${esc(msg)}</div>`);
}

function mountCalendar(clientName, baseUrl, tries = 0) {
  const host = _client === clientName && document.getElementById('cp-cal');
  if (!host) return;
  if (!window.Calendly) {   // widget.js loads async
    if (tries < 20) setTimeout(() => mountCalendar(clientName, baseUrl, tries + 1), 300);
    else host.innerHTML = `<a href="${esc(baseUrl)}" target="_blank" rel="noopener" style="font-size:13px;color:#2563eb">Open the calendar ↗</a>`;
    return;
  }
  let url = baseUrl;
  try {
    const u = new URL(baseUrl);
    const tz = clientIanaTz(clientName);
    if (tz) u.searchParams.set('timezone', tz);
    u.searchParams.set('hide_gdpr_banner', '1');
    url = u.toString();
  } catch (e) { /* keep the raw link */ }
  host.innerHTML = '';
  // This calendar belongs to no deal: a booking here must not land on whichever card set the id last.
  setCalendlyBookingDealId(null);
  window.Calendly.initInlineWidget({ url, parentElement: host });
}

function fillAppointments(clientName, rows) {
  if (_client !== clientName) return;
  const host = document.getElementById('cp-appts');
  const calHost = document.getElementById('cp-cal-upcoming');
  if (!rows.length) {
    if (host) host.innerHTML = `<div style="font-size:12px;color:#94a3b8">No meetings booked for ${esc(clientName)} yet.</div>`;
    if (calHost) calHost.innerHTML = '';
    return;
  }
  const today = getToday();
  const upcoming = rows.filter(r => r.appt >= today).sort((a, b) => a.appt.localeCompare(b.appt) || timeMins(a.time) - timeMins(b.time));
  const past = rows.filter(r => !(r.appt >= today)).sort((a, b) => (b.appt || b.booked || '').localeCompare(a.appt || a.booked || ''));
  const th = 'padding:5px 6px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
  const td = 'padding:6px;border-top:1px solid #e2e8f0;font-size:12px;vertical-align:top';
  const when = r => r.appt ? new Date(r.appt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (r.time ? ' · ' + esc(r.time) : '') : '<span style="color:#94a3b8">no date</span>';
  const table = list => `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Meeting</th><th style="${th}">Lead</th><th style="${th}">Booked</th><th style="${th}">From</th></tr></thead><tbody>
    ${list.map(r => `<tr ${r.dealId && state.deals.some(d => String(d.id) === String(r.dealId)) ? `style="cursor:pointer" data-action="cpOpenDeal" data-id="${esc(r.dealId)}"` : ''}>
      <td style="${td};white-space:nowrap;font-weight:600">${when(r)}</td><td style="${td}">${esc(r.lead || '')}</td>
      <td style="${td};white-space:nowrap;color:#64748b">${esc(r.booked || '')}</td><td style="${td};color:#64748b">${esc(r.source)}</td></tr>`).join('')}
    </tbody></table>`;
  const upcomingCard = scroll => box(heading(`${svgIcon('calendar', 12)} Upcoming (${upcoming.length})`, '#92400e')
    + (upcoming.length ? (scroll ? `<div style="max-height:240px;overflow-y:auto">${table(upcoming)}</div>` : table(upcoming)) : '<div style="font-size:12px;color:#94a3b8">Nothing coming up.</div>'), { bg: '#fffbeb', border: '#fde68a' });
  // Above the calendar it scrolls inside itself, so a long list never pushes the calendar off screen.
  if (calHost) calHost.innerHTML = upcomingCard(true);
  if (!host) return;
  host.innerHTML = upcomingCard(false)
    + box(heading(`Already happened or no date (${past.length})`) + (past.length ? table(past) : '<div style="font-size:12px;color:#94a3b8">None.</div>'))
    + `<div style="font-size:11px;color:#94a3b8">Every meeting booked for ${esc(clientName)}: the lead tracker, retainer pass-offs, and cards on the board with a booked time. Check here before booking a property twice.</div>`;
}

registerActions({
  cpTab(el) { showPane(el.dataset.tab); },
  cpOpenDeal(el) {
    const id = el.dataset.id;
    if (window.closeClientInfoPanel) window.closeClientInfoPanel();
    import('./deal-modal.js?v=20261114001316').then(m => m.openDeal(id));
  },
});
