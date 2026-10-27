// ═══════════════════════════════════════════════════════════
// CHECKINS-DATA — what the Check-ins tab reads, and the session caches
// ═══════════════════════════════════════════════════════════
//
// Three sources, all fetched lazily and cached for the session (closing the
// tab forgets them; the Refresh buttons drop them):
//   - checkin-call-brief (fulfillment project): the check-ins on lars@'s
//     calendar with attendees, and the 2-week / 30-day numbers. The same
//     function posts the Slack brief, so the two can never disagree.
//   - checkin-emails (CRM project): the client's threads with Tim, Aidan and
//     Lars, plus a Claude summary that flags disputes.
//   - CRM state already in memory: renewal, contacts, pass-offs, meetings.

import { supabase } from './supabase-client.js?v=20261028025725';
import { str } from './utils.js?v=20261028025725';
import { invokeEdgeFunctionAsUser } from './edge-auth.js?v=20261028025725';
import { normName, resolveClientName, mdyToIso, localDay } from './weekly-context.js?v=20261028025725';

const BRIEF_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/checkin-call-brief';
export const CALL_DAYS = 7;

const _calls = { loading: false, error: '', data: null };
const _stats = {};    // CRM client name -> { loading, error, data }
const _emails = {};   // client id -> { loading, error, data }

export const callsState = () => _calls;
export const statsState = (name) => _stats[name] || {};
export const emailsState = (id) => _emails[id] || {};

// The fulfillment project can't verify a CRM session at the platform level, so
// the function introspects it itself (verifyCrmUser) — same as client-week-recap.
async function briefCall(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(BRIEF_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({ error: 'checkin-call-brief returned ' + resp.status }));
  if (!resp.ok || data.error) throw new Error(data.error || 'checkin-call-brief failed (' + resp.status + ')');
  return data;
}

// Each loader paints its own loading state, then the result. `paint` is the
// tab's render(); passed in so this module never imports render.js. Every
// render asks for its data, so a load that failed must STAY failed until
// Refresh (force) — retrying on render would repaint and refetch forever.
export async function loadCalls(paint, force = false) {
  if (_calls.loading || ((_calls.data || _calls.error) && !force)) return;
  _calls.loading = true; _calls.error = '';
  paint();
  try { _calls.data = await briefCall({ action: 'upcoming', days: CALL_DAYS }); }
  catch (e) { _calls.error = e.message || 'Could not read the calendar'; }
  _calls.loading = false;
  paint();
}

export async function loadStats(name, paint, force = false) {
  const cur = _stats[name];
  if (!name || cur?.loading || ((cur?.data || cur?.error) && !force)) return;
  _stats[name] = { loading: true, error: '', data: null };
  paint();
  try { _stats[name] = { loading: false, error: '', data: await briefCall({ action: 'stats', client: name }) }; }
  catch (e) { _stats[name] = { loading: false, error: e.message || 'Could not load the numbers', data: null }; }
  paint();
}

export async function loadEmails(clientId, paint, force = false) {
  const cur = _emails[clientId];
  if (!clientId || cur?.loading || ((cur?.data || cur?.error) && !force)) return;
  _emails[clientId] = { loading: true, error: '', data: null };
  paint();
  try { _emails[clientId] = { loading: false, error: '', data: await invokeEdgeFunctionAsUser('checkin-emails', { clientId }) }; }
  catch (e) { _emails[clientId] = { loading: false, error: e.message || 'Could not read email', data: null }; }
  paint();
}

// ─── Calls → CRM clients ───

/** The CRM client a calendar match belongs to: the server's mapping, else the CRM's own name rule. */
export function callClientName(call, clientNames) {
  if (call.crmName && clientNames.includes(call.crmName)) return call.crmName;
  const r = resolveClientName(call.client, clientNames);
  return clientNames.includes(r) ? r : '';
}

/** The call to open by default: the next one that hasn't ended (a call runs ~45 min), else the last. */
export function defaultCall(calls, nowMs = Date.now()) {
  const list = calls || [];
  return list.find(c => Date.parse(c.start) > nowMs - 45 * 60000) || list[list.length - 1] || null;
}

// ─── People ───

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const emailsIn = (s) => (str(s).match(EMAIL_RE) || []).map(e => e.toLowerCase());

/** Everyone the CRM knows at this client, with where we know them from. */
export function knownContacts(c) {
  const out = [];
  const add = (email, name, role) => {
    const e = str(email).toLowerCase();
    const hit = e && out.find(x => x.email === e);
    if (hit) { if (!hit.roles.includes(role)) hit.roles.push(role); if (!hit.name && name) hit.name = name; return; }
    if (e || name) out.push({ email: e, name: str(name), roles: [role] });
  };
  const primary = [str(c.contactFirstName).trim(), str(c.contactLastName).trim()].filter(Boolean).join(' ');
  const notify = emailsIn(c.notifyEmail);
  if (primary || notify.length) add(notify[0] || '', primary, 'Primary contact');
  notify.slice(1).forEach(e => add(e, '', 'Gets lead alerts'));
  emailsIn(c.weeklyUpdateEmails).forEach(e => add(e, '', 'Weekly updates'));
  emailsIn(c.invoiceEmails).forEach(e => add(e, '', 'Invoices'));
  emailsIn(c.otherContacts).forEach(e => add(e, '', 'Additional contact'));
  return out;
}

/** The latest message each address sent us, out of the merged threads. */
export function lastHeardFrom(threads) {
  const out = {};
  for (const t of threads || []) {
    for (const m of t.messages || []) {
      const e = str(m.from).toLowerCase();
      if (e && (!out[e] || m.ts > out[e].ts)) out[e] = { ts: m.ts, name: m.fromName, subject: t.subject };
    }
  }
  return out;
}

// ─── Leads ───

/** Pass-offs and booked meetings for one client since `sinceIso`, newest first, each joined to its deal card. */
export function recentLeads({ clientName, sinceIso, passOffs, trackerEntries, deals, clientNames }) {
  const target = normName(clientName);
  const belongs = raw => normName(resolveClientName(raw, clientNames)) === target;
  const dealByEmail = new Map();
  for (const d of deals || []) {
    for (const f of ['email', 'email2', 'email3', 'email4']) {
      const e = str(d[f]).trim().toLowerCase();
      if (e && !dealByEmail.has(e)) dealByEmail.set(e, d);
    }
  }
  const dealFor = (email) => dealByEmail.get(str(email).trim().toLowerCase()) || null;

  const passed = (passOffs || []).filter(p => belongs(p.clientName)).map(p => {
    const email = str(p.leadEmail || p.email);
    return { kind: 'Passed off', date: localDay(p.datePassed), company: str(p.company), contact: str(p.contact),
      email, appt: '', status: str(p.callbackStatus), deal: dealFor(email) };
  });
  const meetings = (trackerEntries || []).filter(e => belongs(e.clientName)).map(e => {
    const email = str(e.leadEmail || e.email);
    return { kind: 'Meeting booked', date: mdyToIso(e.dateAdded), company: str(e.company), contact: str(e.leadName),
      email, appt: [str(e.apptDate), str(e.apptTime)].filter(Boolean).join(' '), status: str(e.showStatus || e.callbackStatus),
      deal: dealFor(email) };
  });
  return [...passed, ...meetings]
    .filter(l => l.date && l.date >= sinceIso)
    .sort((a, b) => b.date.localeCompare(a.date));
}
