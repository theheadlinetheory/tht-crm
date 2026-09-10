// ═══════════════════════════════════════════════════════════
// CLIENT-OFFBOARD — take a leaving client back out of every system
// ═══════════════════════════════════════════════════════════
// Ordering is the whole design: you cannot snapshot what you have already
// deleted. So everything is READ first, the archive row is written as the
// commit point, and only then is anything taken apart. A failure during
// teardown therefore leaves a complete record and a resumable list, never a
// half-erased client with no trace of what they were. Same lesson as the Won
// modal (commit point early, see won-modal.js).
//
// What this does NOT do, by decision: pause campaigns, detach inboxes (Tim and
// Lars finish those), touch Stripe (the retainer cron already skips inactive
// clients), or delete Smartlead tags (they cannot be deleted).
import { state, pendingWrites } from './app.js?v=20260910153952';
import { esc, str, getToday } from './utils.js?v=20260910153952';
import { supabase, showToast, sbArchiveDeal, sbDeleteDeal, sbUpdateClient, invokeEdgeFunction } from './api.js?v=20260910153952';
import { SUPABASE_ANON_KEY } from './config.js?v=20260910153952';
import { render } from './render.js?v=20260910153952';

const FULFILLMENT_FN = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/crm-client-offboard-record';

// One list: the preview rows ARE the progress rows. Each turns green as it
// completes; a row that needs a hand afterwards shows amber, a failure red.
const TASK_STYLE = {
  todo: ['○', '#475569'],
  run: ['⏳', '#4f46e5'],
  done: ['✓', '#16a34a'],
  hand: ['⚠', '#b45309'],
  fail: ['✗', '#dc2626'],
};

let _o = null; // { client, reason, notes, endedOn, tasks, captured, recorded, crmDone, leadsDone, systems }

// ── Capture (read-only) ───────────────────────────────────────────────
// Everything the CRM knows, gathered before a single thing is taken apart.
export function captureSnapshot(client) {
  const name = str(client.name);
  const leads = (state.deals || []).filter(
    d => str(d.pipeline) === 'Client' && str(d.stage) === name && str(d.leadStatus || 'active') === 'active');
  const tracker = (state.trackerEntries || []).filter(e => str(e.clientName) === name);
  return {
    capturedAt: new Date().toISOString(),
    client: { ...client },
    leadsOnBoard: leads.map(d => ({ id: d.id, company: d.company, contact: d.contact, email: d.email, stage: d.stage })),
    leadTrackerRows: tracker.length,
    // Everything we delivered them; the ones carrying a date were booked calls.
    meetingsBooked: tracker.filter(e => str(e.apptDate).trim()).length,
    leadsDelivered: tracker.length,
    // The positive replies we forwarded are exactly the deals in their column.
    positiveReplies: leads.length,
  };
}

async function callFulfillment(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired — reload and sign in again');
  const resp = await fetch(FULFILLMENT_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({ error: `offboard record returned ${resp.status}` }));
  if (!resp.ok || data.error) throw new Error(data.error || `offboard record failed (${resp.status})`);
  return data;
}

// The jobs no API of ours can finish. Stored on the record and shown on screen,
// so they are handed over rather than quietly dropped.
// Only what genuinely still needs a person. Everything else the flow now does
// itself — the sheet's public link and the GHL sub-account used to live here and
// no longer do.
function manualFollowups(client, systems) {
  const out = [
    'Smartlead campaigns and inboxes — pause the campaigns and return the inboxes to the reserve pool. Left to a person on purpose: which inboxes go back, and when, is a judgement call.',
  ];
  for (const r of systems || []) {
    if (r.status === 'skipped' || r.status === 'failed') {
      out.push(`${r.step}: ${r.reason || 'needs a look'}`);
    }
  }
  return out;
}

// ── The five steps ────────────────────────────────────────────────────
const nextStep = () => !_o.captured ? 0 : !_o.recorded ? 1 : !_o.crmDone ? 2 : !_o.leadsDone ? 3 : 4;

async function runSteps(startIdx) {
  const c = _o.client;
  try {
    for (const t of _o.tasks) if (t.status === 'fail') t.status = 'todo';
    renderTasks();
    setFooter('<span></span><span style="font-size:12px;color:#64748b">Working…</span>');

    if (startIdx <= 0 && !_o.captured) {
      _o.captured = captureSnapshot(c);
    }

    // COMMIT POINT. After this the client's history is safe no matter what
    // fails below, and every later step can simply be retried.
    if (startIdx <= 1 && !_o.recorded) {
      setTask('record', 'run');
      _o.recorded = await callFulfillment({
        clientName: str(c.name),
        // Sent while it still exists — the portal is not deleted until step 5,
        // and the fulfillment campaign cache is keyed on this id, not the uuid.
        smartleadClientId: str(c.smartleadClientId) || null,
        launchDate: str(c.launchDate) || null,
        offboardedOn: _o.endedOn,
        churnReason: _o.reason,
        churnCategory: _o.category || 'other',
        pricingModel: str(c.billingModel) || null,
        revenueCurrency: str(c.retainerCurrency) || null,
        leadsDelivered: _o.captured.leadsDelivered,
        meetingsBooked: _o.captured.meetingsBooked,
        positiveReplies: _o.captured.positiveReplies,
        notes: _o.notes || null,
        snapshot: { crm: _o.captured },
        systemsDisconnected: { crm: { pending: true } },
      });
      setTask('record', 'done');
      setTask('fulfillment_archive', _o.recorded?.archived ? 'done' : 'hand');
    }

    if (startIdx <= 2 && !_o.crmDone) {
      setTask('crm', 'run');
      await sbUpdateClient(c.id, {
        status: 'inactive',
        ended_on: _o.endedOn,
        ended_by: _o.endedBy || null, // They left / We dropped them — level 07's churn-vs-removed switch
        end_reason: _o.reason,
        end_notes: _o.notes || null,
        enable_auto_forward: false,
        enable_forward: 'FALSE',
        enable_tracker: 'FALSE',
        sms_enabled: 'FALSE',
      });
      Object.assign(c, { status: 'inactive', endedOn: _o.endedOn, endReason: _o.reason, endNotes: _o.notes });
      _o.crmDone = true;
      setTask('crm', 'done');
    }

    // Their leads leave the board the same way a won deal does — archived, not
    // orphaned, and individually restorable. lead_tracker is never touched.
    if (startIdx <= 3 && !_o.leadsDone) {
      setTask('leads', 'run');
      for (const lead of _o.captured.leadsOnBoard) {
        const deal = (state.deals || []).find(d => str(d.id) === str(lead.id));
        await sbArchiveDeal(lead.id, JSON.stringify({
          ...(deal || lead), archiveStatus: 'Client Offboarded', pipeline: 'Client', clientName: str(c.name),
        }));
        await sbDeleteDeal(lead.id);
      }
      state.deals = (state.deals || []).filter(
        d => !_o.captured.leadsOnBoard.some(l => str(l.id) === str(d.id)));
      _o.leadsDone = true;
      setTask('leads', 'done');
    }

    if (startIdx <= 4 && !_o.systems) {
      for (const t of _o.tasks) if (t.plan && t.status === 'todo') t.status = 'run';
      renderTasks();
      const r = await invokeEdgeFunction('client-offboard', {
        clientName: str(c.name),
        sheetId: str(c.clientSheetId) || null,
        portalId: str(c.smartleadClientId) || null,
        ghlLocationId: str(c.ghlLocationId) || null,
        notifyEmail: str(c.notifyEmail) || null,
      });
      if (r?.error) throw new Error('Disconnect: ' + r.error);
      _o.systems = r.results || [];

      for (const res of _o.systems) {
        const t = _o.tasks.find(x => x.key === str(res.step));
        if (!t) continue;
        t.status = res.status === 'done' || res.status === 'not_applicable' ? 'done'
          : res.status === 'failed' ? 'fail' : 'hand';
      }
      for (const t of _o.tasks) if (t.plan && t.status === 'run') t.status = 'done';
      renderTasks();

      if (r.results?.some(x => x.step === 'smartlead_portal' && x.status === 'done')) {
        await sbUpdateClient(c.id, { smartlead_client_id: null });
        c.smartleadClientId = '';
      }
      // Record what actually happened, now that it has.
      await callFulfillment({
        clientName: str(c.name),
        smartleadClientId: _o.captured.client.smartleadClientId || null,
        offboardedOn: _o.endedOn,
        churnReason: _o.reason,
        churnCategory: _o.category || 'other',
        leadsDelivered: _o.captured.leadsDelivered,
        meetingsBooked: _o.captured.meetingsBooked,
        positiveReplies: _o.captured.positiveReplies,
        notes: _o.notes || null,
        snapshot: { crm: _o.captured },
        systemsDisconnected: {
          crm: { crm_status: 'inactive', auto_forward: false, leads_archived: _o.captured.leadsOnBoard.length },
          drive: Object.fromEntries((_o.systems || []).filter(x => x.step !== 'smartlead_portal').map(x => [x.step, x])),
          smartlead: (_o.systems || []).find(x => x.step === 'smartlead_portal') || {},
          manual_followups: manualFollowups(c, _o.systems),
        },
      }).catch(e => console.warn('[offboard] final record update failed:', e.message));
    }

    showDone();
  } catch (e) {
    const running = (_o?.tasks || []).find(t => t.status === 'run');
    if (running) running.status = 'fail';
    renderTasks();
    setFooter(`<span></span><div style="display:flex;gap:8px">
      <button onclick="offboardDismiss()" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Close</button>
      <button onclick="offboardRetry()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Retry</button></div>`);
    const tail = _o.recorded ? ' — the offboarding record is already saved; Retry picks up where it stopped.' : '';
    showToast('Offboarding step failed: ' + (e?.message || e) + tail, 'error');
  } finally {
    pendingWrites.value = Math.max(0, pendingWrites.value);
  }
}

// ── UI ────────────────────────────────────────────────────────────────
const overlay = () => document.getElementById('offboard-overlay');

function renderTasks() {
  const el = document.getElementById('offboard-tasks');
  if (!el || !_o) return;
  el.innerHTML = (_o.tasks || []).map(t => {
    const [icon, col] = TASK_STYLE[t.status] || TASK_STYLE.todo;
    return `<div style="font-size:12.5px;line-height:1.55;color:${col}">${icon} ${esc(t.label)}</div>`;
  }).join('');
}

function setTask(key, status) {
  const t = (_o?.tasks || []).find(x => x.key === key);
  if (t) t.status = status;
  renderTasks();
}

function setFooter(html) {
  const f = document.getElementById('offboard-footer');
  if (f) f.innerHTML = html;
}

function showDone() {
  const done = document.getElementById('offboard-done');
  if (!done) return;
  const follow = manualFollowups(_o.client, _o.systems);
  if (_o.recorded && !_o.recorded.archived) {
    follow.push('Fulfillment dashboard: the name did not match a fulfillment client — set them to Archived by hand.');
  }
  const items = follow.map(t => `<li style="margin-bottom:5px">${esc(t)}</li>`).join('');
  done.innerHTML = `<div style="padding:12px 0 2px">
    <div style="font-size:13px;color:#16a34a;font-weight:700;margin-bottom:8px">${esc(str(_o.client.name))} offboarded</div>
    <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:6px">Still to do by hand</div>
    <ul style="margin:0;padding-left:18px;font-size:11px;color:#92400e;line-height:1.5">${items}</ul>
  </div>`;
  setFooter(`<span style="font-size:11px;color:#64748b">Saved to client_offboarding</span>
    <button onclick="offboardDismiss()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Done</button>`);
  render();
}

/** Preview first — the portal delete cannot be undone, so show the plan. */
export async function openOffboard(clientId, { reason, notes, endedOn, category, endedBy } = {}) {
  const c = (state.clients || []).find(x => str(x.id) === str(clientId));
  if (!c) return;
  _o = { client: c, reason: reason || 'Offboarded', endedBy: endedBy || null, notes: notes || '', endedOn: endedOn || getToday(), category };

  document.getElementById('offboard-overlay')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="offboard-overlay" style="position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto">
    <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0"><h2 style="margin:0;font-size:17px;color:#1e293b">Offboard ${esc(str(c.name))}</h2></div>
      <div id="offboard-body" style="padding:18px 22px;max-height:60vh;overflow-y:auto"><div style="font-size:12px;color:#64748b">Checking what this will touch…</div></div>
      <div id="offboard-footer" style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px"></div>
    </div></div>`);

  const snap = captureSnapshot(c);
  let plan = [];
  try {
    const r = await invokeEdgeFunction('client-offboard', {
      clientName: str(c.name), sheetId: str(c.clientSheetId) || null,
      portalId: str(c.smartleadClientId) || null,
      ghlLocationId: str(c.ghlLocationId) || null,
      notifyEmail: str(c.notifyEmail) || null, dryRun: true,
    });
    plan = r?.plan || [];
  } catch (e) { plan = [{ step: 'preview', action: 'Could not reach Drive/Smartlead — ' + e.message }]; }

  _o.tasks = [
    { key: 'record', label: 'Save the offboarding record to the fulfillment database', status: 'todo' },
    { key: 'fulfillment_archive', label: 'Mark them Archived in the fulfillment dashboard', status: 'todo' },
    { key: 'crm', label: 'Mark them inactive in the CRM and turn off forwarding', status: 'todo' },
    { key: 'leads', label: `Archive ${snap.leadsOnBoard.length} lead${snap.leadsOnBoard.length === 1 ? '' : 's'} off the Client Leads board (restorable from Archive)`, status: 'todo' },
    ...plan.map(p => ({ key: str(p.step), label: str(p.action), status: 'todo', plan: true })),
  ];

  const body = document.getElementById('offboard-body');
  if (!body) return;
  body.innerHTML = `<div style="font-size:12px;color:#475569;line-height:1.6">
      <div style="font-weight:700;color:#1e293b;margin-bottom:8px">This will:</div>
      <div id="offboard-tasks" style="display:flex;flex-direction:column;gap:4px"></div>
      <div style="margin-top:10px;font-size:11px;color:#94a3b8">All ${snap.leadTrackerRows} Lead Tracker row${snap.leadTrackerRows === 1 ? '' : 's'} stay — still filterable by client, and still billable for the final month.</div>
      <div id="offboard-done"></div>
    </div>`;
  renderTasks();
  document.getElementById('offboard-footer').innerHTML =
    `<button onclick="offboardDismiss()" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
     <button onclick="offboardStart()" style="padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Offboard ${esc(str(c.name))}</button>`;
}

export function offboardDismiss() { overlay()?.remove(); _o = null; }
export async function offboardStart() { await runSteps(0); }
export async function offboardRetry() { await runSteps(nextStep()); }

window.openOffboard = openOffboard;
window.offboardDismiss = offboardDismiss;
window.offboardStart = offboardStart;
window.offboardRetry = offboardRetry;
