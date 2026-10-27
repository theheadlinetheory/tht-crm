// ═══════════════════════════════════════════════════════════
// CLIENT-COLD-CALLS — the client panel's cold-calling section
// ═══════════════════════════════════════════════════════════
//
// The client's JustCall Sales Dialer campaigns with their counts, and a Redial button per campaign.
// Everything comes from the fulfillment dashboard's justcall-cold-calls function (one JustCall
// integration, one source of truth): it accepts a CRM session and finds the dashboard client by name.
// Redial = the same as the dashboard's Cold Calling card: once a list is finished, its no answer /
// voicemail / manager not around contacts go into "<Client> - Redial <List>" on the same caller ID.
//
// Not the power dialer (cold-calling.js): that one is for warm inbound leads.

import { supabase } from './supabase-client.js?v=20261027210958';
import { esc } from './utils.js?v=20261027210958';
import { registerActions } from './delegate.js?v=20261027210958';

const FN = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/justcall-cold-calls';
const RATE_LIMIT_WAIT_MS = 15000; // JustCall's limit is account-wide: a script loading a list can exhaust it
const MAX_STALLS = 8;
const CONTAINER_ID = 'cp-cold-calls';

const OUTCOME_LABELS = {
  booked: 'appointment booked',
  not_interested: 'not interested',
  under_contract: 'under contract',
  picked_up: 'picked up (no disposition)',
  manager_not_around: 'manager not around',
  no_answer: 'no answer',
  voicemail: 'voicemail',
  bad_number: 'bad number',
  desk_dq: 'desk DQ',
};

let _clientName = null;

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

/** "75 dials · 3 no answer · 1 appointment booked · 10 not interested" */
function breakdown(c) {
  const parts = [`${c.dialed} dial${c.dialed === 1 ? '' : 's'}`];
  for (const [k, label] of Object.entries(OUTCOME_LABELS)) {
    const n = (c.outcomes || {})[k];
    if (n) parts.push(`${n} ${label}`);
  }
  return parts.join(' · ');
}

function redialCell(c) {
  if (c.redialed_into) return `<span style="font-size:11px;color:#64748b">Redialed → #${c.redialed_into}</span>`;
  const left = c.contacts - c.dialed;
  const label = !c.finished ? `Finish list first (${left} left)` : c.redial ? `Redial missed (${c.redial})` : 'Nobody to redial';
  const disabled = !c.finished || !c.redial;
  return `<button class="btn" data-action="ccRedial" data-id="${c.justcall_campaign_id}" ${disabled ? 'disabled' : ''}
    title="${c.finished ? 'No answer, voicemail and manager not around, minus properties someone already answered at' : 'Unlocks once the whole list has been dialed'}"
    style="font-size:11px;padding:4px 10px;white-space:nowrap">${label}</button>`;
}

function render(data) {
  const el = document.getElementById(CONTAINER_ID);
  if (!el) return;
  const campaigns = data.campaigns || [];
  if (!campaigns.length) {
    el.innerHTML = `<div style="font-size:12px;color:#94a3b8">No JustCall campaigns for this client yet.</div>`;
    return;
  }
  const num = 'text-align:right;padding:4px 6px';
  let h = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="color:#64748b;font-size:11px;text-align:left">
      <th style="padding:4px 0;font-weight:500">Campaign</th>
      <th style="${num};font-weight:500">Dials</th>
      <th style="${num};font-weight:500">Picked up</th>
      <th style="${num};font-weight:500" title="No answer, voicemail, manager not around">No answer</th>
      <th style="${num};font-weight:500">Booked</th>
      <th></th>
    </tr></thead><tbody>`;
  for (const c of campaigns) {
    const guessed = c.dialed - c.dispositioned;
    h += `<tr style="border-top:1px solid #e2e8f0;vertical-align:top">
      <td style="padding:6px 0">
        <div style="font-weight:600;color:#1e293b">${esc(c.name)}</div>
        <div style="font-size:11px;color:#64748b">#${c.justcall_campaign_id} · ${esc(c.status)} · ${esc(c.caller_id || 'no caller ID')}</div>
        <div style="font-size:11px;color:#475569;margin-top:2px">${esc(breakdown(c))}</div>
        ${guessed > 0 ? `<div style="font-size:11px;color:#b45309">${guessed} dialed without a disposition (JustCall's own guess)</div>` : ''}
      </td>
      <td style="${num}">${c.dialed} / ${c.contacts}</td>
      <td style="${num}">${c.picked_up}</td>
      <td style="${num}">${c.no_answer}</td>
      <td style="${num};font-weight:600">${c.booked}</td>
      <td style="padding:6px 0 6px 6px;text-align:right">${redialCell(c)}</td>
    </tr>`;
  }
  h += `</tbody></table><div id="cp-cc-status" style="font-size:12px;margin-top:8px"></div>`;
  el.innerHTML = h;
}

/** Loads and renders the section for `clientName` into #cp-cold-calls (if the panel is still open on it). */
export async function fillColdCallsSection(clientName) {
  _clientName = clientName;
  try {
    const data = await call('list', { crm_client_name: clientName });
    if (_clientName === clientName) render(data);
  } catch (e) {
    const el = document.getElementById(CONTAINER_ID);
    if (el && _clientName === clientName) el.innerHTML = `<div style="font-size:12px;color:#dc2626">Couldn't load JustCall: ${esc(e.message)}</div>`;
  }
}

export function coldCallsSectionHtml() {
  return `<div style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Cold Calling</div>
    <div id="${CONTAINER_ID}"><div style="font-size:12px;color:#94a3b8">Loading JustCall…</div></div>
  </div>`;
}

function setStatus(html) {
  const el = document.getElementById('cp-cc-status');
  if (el) el.innerHTML = html;
}

/** Fills a fresh campaign in dial order, ≤10 contacts per call, waiting out JustCall's rate limit. */
async function fill({ campaign_id, name, contacts }) {
  let done = 0;
  for (let stalls = 0; done < contacts.length;) {
    setStatus(`Adding contacts to ${esc(name)}: ${done}/${contacts.length}…`);
    const { added, rate_limited } = await call('add_contacts', { campaign_id, contacts: contacts.slice(done) });
    done += added;
    stalls = added ? 0 : stalls + 1;
    if (stalls > MAX_STALLS) throw new Error(`JustCall kept rate-limiting; ${done}/${contacts.length} added to ${name}`);
    if (rate_limited) await new Promise(res => setTimeout(res, RATE_LIMIT_WAIT_MS));
  }
}

registerActions({
  async ccRedial(el) {
    const clientName = _clientName;
    document.querySelectorAll(`#${CONTAINER_ID} [data-action="ccRedial"]`).forEach(b => { b.disabled = true; });
    el.textContent = 'Creating…';
    try {
      const created = await call('redial', { justcall_campaign_id: Number(el.dataset.id) });
      await fill(created);
      await fillColdCallsSection(clientName);
      setStatus(`<span style="color:#15803d;font-weight:600">✓ Redial campaign created: ${esc(created.name)}</span> — ${created.contacts.length} contacts on ${esc(created.caller_id || 'the same caller ID')}. Open JustCall Sales Dialer to dial it.`);
    } catch (e) {
      await fillColdCallsSection(clientName);
      setStatus(`<span style="color:#dc2626">Redial failed: ${esc(e.message)}</span>`);
    }
  },
});
