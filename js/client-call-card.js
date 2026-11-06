// ═══════════════════════════════════════════════════════════
// CLIENT-CALL-CARD — the client panel on the Cold Calling board, as tabs
// ═══════════════════════════════════════════════════════════
//
// Ioannis, 2026-11-04: the call sheet (Google Doc) and the client card were two places to look, and finding an
// answer mid-call meant scrolling. So on the Cold Calling board the card IS the call sheet, one tab per thing a
// caller looks for: Map, Services, Properties, Questions, Quick lines, Who we want, Client info, Appointments,
// Cold calling. Every call sheet field (clients.call_*) shows here and edits in place; an edit rebuilds the doc
// within a minute (the clients trigger), so the doc stays in step for anyone still using it.
//
// client-panel.js owns the overlay and the editable blocks; this module only lays them out in tabs and owns the
// Appointments tab. The panel is never re-rendered while open, so switching tabs only flips which pane shows.

import { state } from './app.js?v=20261106121027';
import { esc, str, svgIcon, getToday } from './utils.js?v=20261106121027';
import { supabase } from './supabase-client.js?v=20261106121027';
import { registerActions } from './delegate.js?v=20261106121027';

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
 * coldCalls, callSheetLink, calendly, serviceAreaLink, billing (HTML strings or a function for editable blocks).
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
      + parts.calendly + ed('call_booking_notes', cl)
      + ed('call_display_name', cl) + ed('call_meets_lead', cl) + ed('call_shop', cl) + ed('location', cl) + '<div id="cp-loc-hint" style="margin:-12px 0 16px"></div>'
      + ed('call_caller_id', cl) + ed('call_get_extra', cl) + ed('call_confirmation_email', cl)
      + parts.contact + parts.callSheetLink + parts.billing,
    appointments: `<div id="cp-appts"><div style="font-size:12px;color:#94a3b8">Loading appointments…</div></div>`,
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

async function loadAppointments(clientName) {
  try {
    const [lt, po] = await Promise.all([
      supabase.from('lead_tracker').select('deal_id,lead_name,date_added,created_at,appt_date,appt_time,lead_source').eq('client_name', clientName).limit(1000),
      supabase.from('pass_offs').select('deal_id,company,contact,date_passed,appt_date,appt_time').eq('client_name', clientName).limit(1000),
    ]);
    if (lt.error) throw lt.error;
    if (po.error) throw po.error;
    const deal = id => state.deals.find(d => String(d.id) === String(id));
    const rows = [
      ...(lt.data || []).map(r => ({ lead: r.lead_name, booked: isoDate(r.created_at) || isoDate(r.date_added), appt: isoDate(r.appt_date), time: r.appt_time, source: r.lead_source === 'cold_call' ? 'Cold call' : 'Email', dealId: r.deal_id })),
      ...(po.data || []).map(r => ({ lead: [r.company, r.contact].filter(Boolean).join(' — '), booked: isoDate(r.date_passed), appt: isoDate(r.appt_date), time: r.appt_time, source: deal(r.deal_id)?.leadSource === 'cold_call' ? 'Cold call' : 'Passed off', dealId: r.deal_id })),
    ];
    // Booked on the board but not delivered yet: still a meeting.
    const delivered = new Set(rows.map(r => r.dealId).filter(Boolean));
    for (const d of state.deals) {
      if (d.pipeline !== 'Client' || d.stage !== clientName || !d.bookedDate || delivered.has(d.id)) continue;
      rows.push({ lead: [d.company, d.contact].filter(Boolean).join(' — '), booked: isoDate(d.createdDate || d.createdAt), appt: isoDate(d.bookedDate), time: d.bookedTime, source: d.leadSource === 'cold_call' ? 'Cold call' : 'Email', dealId: d.id, onBoard: true });
    }
    fillAppointments(clientName, rows);
  } catch (e) {
    const host = _client === clientName && document.getElementById('cp-appts');
    if (host) host.innerHTML = `<div style="font-size:12px;color:#dc2626">Couldn't load appointments: ${esc(e.message || String(e))}</div>`;
  }
}

function fillAppointments(clientName, rows) {
  const host = _client === clientName && document.getElementById('cp-appts');
  if (!host) return;
  if (!rows.length) { host.innerHTML = `<div style="font-size:12px;color:#94a3b8">No meetings booked for ${esc(clientName)} yet.</div>`; return; }
  const today = getToday();
  const upcoming = rows.filter(r => r.appt >= today).sort((a, b) => (a.appt + str(a.time)).localeCompare(b.appt + str(b.time)));
  const past = rows.filter(r => !(r.appt >= today)).sort((a, b) => (b.appt || b.booked || '').localeCompare(a.appt || a.booked || ''));
  const th = 'padding:5px 6px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
  const td = 'padding:6px;border-top:1px solid #e2e8f0;font-size:12px;vertical-align:top';
  const when = r => r.appt ? new Date(r.appt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (r.time ? ' · ' + esc(r.time) : '') : '<span style="color:#94a3b8">no date</span>';
  const table = list => `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Meeting</th><th style="${th}">Lead</th><th style="${th}">Booked</th><th style="${th}">From</th></tr></thead><tbody>
    ${list.map(r => `<tr ${r.dealId && state.deals.some(d => String(d.id) === String(r.dealId)) ? `style="cursor:pointer" data-action="cpOpenDeal" data-id="${esc(r.dealId)}"` : ''}>
      <td style="${td};white-space:nowrap;font-weight:600">${when(r)}</td><td style="${td}">${esc(r.lead || '')}</td>
      <td style="${td};white-space:nowrap;color:#64748b">${esc(r.booked || '')}</td><td style="${td};color:#64748b">${esc(r.source)}</td></tr>`).join('')}
    </tbody></table>`;
  host.innerHTML = box(heading(`${svgIcon('calendar', 12)} Upcoming (${upcoming.length})`, '#92400e') + (upcoming.length ? table(upcoming) : '<div style="font-size:12px;color:#94a3b8">Nothing coming up.</div>'), { bg: '#fffbeb', border: '#fde68a' })
    + box(heading(`Already happened or no date (${past.length})`) + (past.length ? table(past) : '<div style="font-size:12px;color:#94a3b8">None.</div>'))
    + `<div style="font-size:11px;color:#94a3b8">Every meeting booked for ${esc(clientName)}: the lead tracker, retainer pass-offs, and cards on the board with a booked time. Check here before booking a property twice.</div>`;
}

registerActions({
  cpTab(el) { showPane(el.dataset.tab); },
  cpOpenDeal(el) {
    const id = el.dataset.id;
    if (window.closeClientInfoPanel) window.closeClientInfoPanel();
    import('./deal-modal.js?v=20261106121027').then(m => m.openDeal(id));
  },
});
