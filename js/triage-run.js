// "Run this week" for the Client Triage tab.
//
// The browser drives the run because a full pass needs ~1,200 SmartLead
// analytics-by-date calls and that cannot finish inside one edge-function
// invocation. So: bootstrap once, then many small batches with visible
// progress, then score locally and save. Same shape as the Analysis tab.
//
// Nothing sensitive travels without auth — every call carries the operator's own
// CRM session, which the function verifies before reading anything.

import { supabase } from './supabase-client.js?v=20260918110319';
import { buildSnapshot, offerOf, makeAttributor } from './triage-score.js?v=20260918110319';

const FN = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/client-triage';
const BATCH = 100;               // the function refuses batches over 120

async function call(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await resp.json().catch(() => ({ error: `${action} returned a non-JSON response (${resp.status})` }));
  if (!resp.ok || body.error) throw new Error(body.error || `${action} failed (${resp.status})`);
  return body;
}

const monday = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** One job per week each campaign has existed. DRAFTED campaigns never sent. */
function weekJobs(campaigns, attribute, today) {
  const jobs = [];
  for (const c of campaigns) {
    if (c.status === 'DRAFTED' || !attribute(c.name)) continue;
    for (let w = monday(c.created_at); w <= monday(today); w = addDays(w, 7)) {
      jobs.push({ id: c.id, start: w, end: addDays(w, 6) });
    }
  }
  return jobs;
}

export async function runTriage({ today, prior, onProgress }) {
  const say = (m) => onProgress && onProgress(m);

  say('Reading the CRM, the fulfillment dashboard and the campaign list…');
  const boot = await call('bootstrap');
  const attribute = makeAttributor(boot.crmClients);

  // Booked meetings straight out of the client sheets — this is what keeps
  // pay-per-lead scoring honest. A missing sheet is reported, not swallowed.
  const wanted = boot.crmClients
    .filter(c => c.status === 'active' && c.billing_model === 'per_lead' && c.client_sheet_id)
    .map(c => ({ client: c.name, sheetId: c.client_sheet_id }));
  say(`Reading ${wanted.length} client sheets for booked meetings…`);
  let sheetBookings = {}, sheetErrors = {};
  try {
    const r = await call('sheets', { sheets: wanted });
    sheetBookings = r.bookings || {};
    sheetErrors = r.errors || {};
  } catch (e) {
    sheetErrors = { _all: String(e.message || e) };
  }

  const jobs = weekJobs(boot.campaigns, attribute, today);
  say(`Fetching ${jobs.length.toLocaleString()} campaign-weeks from Smartlead — this is the slow part…`);
  const weeks = [];
  let failed = 0;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const r = await call('weeks', { jobs: jobs.slice(i, i + BATCH) });
    weeks.push(...r.rows);
    failed += r.failed || 0;
    say(`Smartlead ${Math.min(i + BATCH, jobs.length).toLocaleString()} / ${jobs.length.toLocaleString()} campaign-weeks…`);
  }

  say('Scoring…');
  const snap = buildSnapshot({ boot, weeks, sheetBookings, prior, today });

  if (failed) {
    snap.META.warnings.push(`${failed} campaign-week Smartlead calls failed after retries; those weeks count as zero send and understate rates.`);
  }
  for (const [client, err] of Object.entries(sheetErrors)) {
    snap.META.warnings.push(`Could not read ${client === '_all' ? 'any client sheet' : client + "'s sheet"} (${err}) — its booked meetings are missing, which reads as underperformance.`);
  }
  if (snap.META.replyMiningDate) {
    const age = Math.round((Date.parse(today) - Date.parse(snap.META.replyMiningDate)) / 86400000);
    if (age > 9) {
      snap.META.warnings.push(`Objection buckets are carried forward from the ${snap.META.replyMiningDate} reply-mining pass (${age} days old). Dimension 4 and the tier 3/4 diagnostic describe that window, not this week.`);
    }
  } else {
    snap.META.warnings.push('No previous snapshot to carry objection buckets from — dimension 4 scores 0 for every client this run.');
  }

  say('Saving…');
  const saved = await call('save', { as_of: today, snapshot: snap });
  say('Done.');
  return { snap, ranBy: saved.ran_by };
}

/** Weeks already stored server-side, newest first. */
export async function listSavedWeeks() {
  const r = await call('list');
  return (r.weeks || []).map(w => w.as_of);
}

export async function getSavedWeek(asOf) {
  const r = await call('get', { as_of: asOf });
  return r.snapshot;
}
