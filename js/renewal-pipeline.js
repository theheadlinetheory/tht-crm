// ═══════════════════════════════════════════════════════════
// CLIENT JOURNEY — the board for won clients, from onboarding through renewal
// and upsells (Aidan, 2026-10-14 as the Renewal pipeline; widened 2026-11-18).
// Lives under Acquisition → Client Journey beside the Schedule table.
//
// Two lanes, one deals pipeline ('Renewal'):
//  - Journey: ONE card per client, in exactly one stage (JOURNEY_STAGES).
//    Renewal stages are retainer-only; a pay-per-meeting client (billing_model
//    'per_lead') sits in Active instead and can't be dropped on them.
//  - Upsells: zero or more cards per client (UPSELL_STAGES), so a client can be
//    renewing and mid-upsell at once. Retainer clients only for now.
// A card whose client is inactive in Settings → Clients (churned) is hidden,
// never deleted — its stage history stays.
//
// A card is an ordinary `deals` row with pipeline 'Renewal'. Closing an
// Acquisition deal Won used to be the end of the road: it was archived and
// deleted. deleteDeal (deals.js) still does that — every won metric reads the
// archive — and then calls createRenewalCard, so the client starts this board
// at Onboarded instead of leaving the CRM.
//
// The card is a NEW row, copying contact details only. It carries no
// sl_lead_id / aimfox_lead_id on purpose: find-existing-deal.ts matches on
// sl_lead_id across every pipeline, so a stray acquisition reply would
// otherwise land on (and re-stage) the renewal card.
//
// Stage history: a trigger on deals logs every Renewal stage change into
// deal_stage_events, and the renewal_stage_dates view gives each card the
// first time it reached each stage (tht-crm-backend migration
// 20261014_renewal_pipeline_stage_events.sql). The board reads that view for
// "N days in stage".
//
// Admin-only, like the Renewals tab it replaced (the Schedule shows retainer amounts).
// ═══════════════════════════════════════════════════════════
import { state, store } from './app.js?v=20261118232729';
import { render } from './render.js?v=20261118232729';
import { supabase } from './supabase-client.js?v=20261118232729';
import { sbCreateDeal, camelToSnake, showToast } from './api.js?v=20261118232729';
import { RENEWAL_STAGES, JOURNEY_STAGES, UPSELL_STAGES } from './config.js?v=20261118232729';
import { esc, str, uid, getToday, jsArg } from './utils.js?v=20261118232729';
import { moveDeal, clearAllDragOver } from './deals.js?v=20261118232729';

export const RENEWAL_PIPELINE = 'Renewal';
const FIRST_STAGE = JOURNEY_STAGES[0].id;
const UPSELL_IDS = new Set(UPSELL_STAGES.map(s => s.id));
export const isUpsellCard = (d) => UPSELL_IDS.has(str(d.stage));
const STAGE_DATE_COL = {
  'Onboarded': 'onboarded_at',
  'Campaigns Started': 'campaigns_started_at',
  'Activation Point': 'activation_at',
  'Renewal Call Booked': 'renewal_call_booked_at',
  'Renewal Offered': 'renewal_offered_at',
  'Renewal Closed': 'renewal_closed_at',
};

const sameName = (a, b) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
export const renewalDeals = () => state.deals.filter(d => d.pipeline === RENEWAL_PIPELINE);
const journeyDeals = () => renewalDeals().filter(d => !isUpsellCard(d));
const cardFor = (clientName) => journeyDeals().find(d => sameName(d.company, clientName));
const clientFor = (name) => (state.clients || []).find(c => sameName(c.name, name));
// Pay-per-meeting unless the client record says retainer (client-info.js defaults the same way).
const modelOf = (name) => str(clientFor(name)?.billingModel) === 'retainer' ? 'retainer' : 'per_lead';
const stageFits = (stage, name) => !stage || stage.models === 'all' || !clientFor(name) || stage.models === modelOf(name);
// Churn sync: the client record decides. Unknown names stay visible so a typo can't hide a client.
const isChurned = (d) => clientFor(d.company)?.status === 'inactive';

// ─── Hand-off from Acquisition ───
/** Start a won client on the Renewal board at Onboarded. One card per client:
 *  a second won deal for the same client (e.g. Link to existing) is a no-op. */
export async function createRenewalCard(fromDeal, clientName) {
  const name = str(clientName).trim() || str(fromDeal?.company).trim();
  if (!name || cardFor(name)) return null;
  const d = fromDeal || {};
  const card = {
    id: uid(), pipeline: RENEWAL_PIPELINE, stage: FIRST_STAGE, flag: '',
    company: name,
    contact: str(d.contact), email: str(d.email), phone: str(d.phone), mobilePhone: str(d.mobilePhone),
    jobTitle: str(d.jobTitle), website: str(d.website), location: str(d.location), address: str(d.address),
    vertical: str(d.vertical),
    notes: d.id ? `Won from Acquisition deal ${d.id} on ${getToday()}.` : '',
    createdDate: getToday(), lastUpdated: getToday(),
  };
  store.addDeal(card);
  try {
    await sbCreateDeal(camelToSnake(card));
  } catch (e) {
    console.error('[renewal] card not created:', e);
    showToast(`Renewal card for ${name} was not saved: ${e?.message || e}`, 'error');
  }
  _loadedAt = 0; // its Onboarded date exists now
  return card;
}

// ─── Stage dates (renewal_stage_dates view) ───
let _dates = {};      // { [deal_id]: row }
let _status = 'idle'; // idle | loading | loaded | error
let _loadedAt = 0;
const STALE_MS = 60000;

export async function loadRenewalDates() {
  if (_status === 'loading') return;
  _status = 'loading';
  try {
    const rows = [];
    for (let off = 0; ; off += 1000) { // PostgREST caps a response at 1000 rows
      const { data, error } = await supabase.from('renewal_stage_dates').select('*').range(off, off + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    _dates = Object.fromEntries(rows.map(r => [str(r.deal_id), r]));
    _status = 'loaded';
  } catch (e) {
    // The board still works without dates; just say so once per failure.
    _status = 'error';
    console.warn('[renewal] stage dates not loaded:', e?.message || e);
  }
  _loadedAt = Date.now();
  render();
}

const daysSince = (iso) => iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null;
const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

// ─── Board ───
function cardHtml(deal, stageKey) {
  const r = _dates[str(deal.id)] || {};
  const inStage = daysSince(r.current_stage_since);
  const reached = RENEWAL_STAGES
    .filter(s => r[STAGE_DATE_COL[s.id]])
    .map(s => `${s.label}: ${shortDate(r[STAGE_DATE_COL[s.id]])}`).join('\n');
  return `<div class="deal-card" draggable="true" data-renewal-id="${esc(deal.id)}"
      ondragstart="event.dataTransfer.effectAllowed='move';state.dragId=${jsArg(deal.id)}"
      ondragend="clearAllDragOver()"
      ondragover="event.preventDefault();doDragOver(this.closest('.column'))"
      ondrop="renewalDrop('${stageKey}')"
      onclick="openDeal(${jsArg(deal.id)})" title="${esc(reached || 'No stage history yet')}">
    <div class="deal-card-top"><div class="deal-company">${esc(deal.company || deal.contact || 'Client')}</div></div>
    ${isUpsellCard(deal) && str(deal.notes).startsWith('Upsell: ') ? `<div class="deal-detail" style="color:var(--purple);font-weight:600">${esc(str(deal.notes).split('\n')[0].slice(8))}</div>` : ''}
    ${deal.contact ? `<div class="deal-detail">${esc(deal.contact)}</div>` : ''}
    <div class="deal-bottom"><span style="display:flex;gap:4px;flex-wrap:wrap">
      ${r.onboarded_at ? `<span class="deal-tag">Onboarded ${esc(shortDate(r.onboarded_at))}</span>` : ''}
      ${inStage !== null ? `<span class="deal-tag" style="background:#f1f5f9;color:#475569">${inStage}d in stage</span>` : ''}
    </span></div>
  </div>`;
}

function addClientPicker() {
  const onBoard = new Set(journeyDeals().map(d => str(d.company).trim().toLowerCase()));
  const missing = (state.clients || [])
    .filter(c => c.status !== 'inactive' && !onBoard.has(str(c.name).trim().toLowerCase()))
    .map(c => str(c.name)).sort((a, b) => a.localeCompare(b));
  if (!missing.length) return '';
  return `<select id="renewal-add-client" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="">Add an existing client…</option>
      ${missing.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
    </select>
    <button class="btn btn-ghost" style="font-size:12px" onclick="renewalAddClient()">+ Add</button>`;
}

function addUpsellPicker() {
  const names = journeyDeals().filter(d => !isChurned(d) && stageFits(UPSELL_STAGES[0], d.company)).map(d => str(d.company)).sort((a, b) => a.localeCompare(b));
  if (!names.length) return '';
  const inp = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)';
  return `<select id="upsell-client" style="${inp}"><option value="">Client…</option>
      ${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>
    <input id="upsell-what" placeholder="What's offered (e.g. cold calling)" style="${inp};width:220px">
    <button class="btn btn-ghost" style="font-size:12px" onclick="renewalAddUpsell()">+ Upsell</button>`;
}

function laneHtml(stages, deals, noun) {
  let html = '<div class="board">';
  for (const stage of stages) {
    const sd = deals.filter(d => d.stage === stage.id);
    const stageKey = btoa(unescape(encodeURIComponent(stage.id)));
    const note = stage.models === 'retainer' ? 'Retainer clients only' : stage.models === 'per_lead' ? 'Pay-per-meeting only' : '';
    html += `<div class="column" ondragover="event.preventDefault();doDragOver(this)" ondragleave="doDragLeave(event,this)" ondrop="renewalDrop('${stageKey}')">
      <div class="col-header" style="border-top-color:${stage.color}"><div>
        <div class="col-title"${stage.hint ? ` title="${esc(stage.hint)}"` : ''}>${esc(stage.label)}</div>
        ${stage.hint ? `<div class="col-meta" style="font-style:italic">${esc(stage.hint)}</div>` : ''}
        <div class="col-meta">${sd.length} ${noun}${sd.length !== 1 ? 's' : ''}${note ? ` · ${note}` : ''}</div>
      </div></div>
      <div class="col-body">${sd.length ? sd.map(d => cardHtml(d, stageKey)).join('') : `<div class="col-empty">No ${noun}s yet</div>`}</div>
    </div>`;
  }
  return html + '</div>';
}

export function renderRenewalPipeline() {
  if (_status !== 'loading' && Date.now() - _loadedAt > STALE_MS) loadRenewalDates();
  const all = renewalDeals();
  const churned = all.filter(isChurned);
  const live = all.filter(d => !isChurned(d));
  const journey = live.filter(d => !isUpsellCard(d));
  const upsells = live.filter(isUpsellCard);
  const churnedNames = [...new Set(churned.map(d => str(d.company)))].sort((a, b) => a.localeCompare(b));
  const bar = 'padding:0 20px 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-muted)';
  let html = `<div style="${bar}">
    <span>${journey.length} client${journey.length !== 1 ? 's' : ''} · one card per client, drag to move it. Every move is logged with its date.</span>
    ${_status === 'error' ? '<span style="color:#b91c1c">Stage dates did not load.</span>' : ''}
    <span style="flex:1"></span>${addClientPicker()}
  </div>`;
  if (churnedNames.length) html += `<div style="padding:0 20px 8px;font-size:11px;color:#94a3b8" title="Inactive in Settings → Clients. Hidden, not deleted — stage history is kept.">Hidden, churned: ${churnedNames.map(esc).join(', ')}</div>`;
  html += laneHtml(JOURNEY_STAGES, journey, 'client');
  html += `<div style="${bar};padding-top:14px;border-top:1px solid var(--border);margin-top:6px">
    <strong style="color:var(--text)">Upsells</strong>
    <span>${upsells.length} · anything agreed that raises what the client pays — retainer clients only (no pay-per-meeting upsells yet)</span>
    <span style="flex:1"></span>${addUpsellPicker()}
  </div>`;
  html += laneHtml(UPSELL_STAGES, upsells, 'upsell');
  // A card whose stage isn't a board column (renamed stage, hand edit) would vanish — list it instead.
  const stray = live.filter(d => !RENEWAL_STAGES.some(s => s.id === d.stage));
  if (stray.length) html += `<div style="padding:8px 20px;font-size:12px;color:#b91c1c">Off-board stage: ${stray.map(d => `<a href="#" onclick="event.preventDefault();openDeal(${jsArg(d.id)})">${esc(d.company)} (${esc(d.stage || 'blank')})</a>`).join(', ')}</div>`;
  return html;
}

// ─── Sub-tabs (Pipeline / Schedule) ───
export function renderRenewalsSubTabs() {
  const sub = state.renewalsSubTab === 'schedule' ? 'schedule' : 'pipeline';
  const cs = 'padding:6px 16px;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;border-radius:6px;margin-right:4px';
  const btn = (id, label) => `<button onclick="switchRenewalsSubTab('${id}')" style="${cs};background:${sub === id ? 'var(--purple)' : '#f3f4f6'};color:${sub === id ? '#fff' : 'var(--text-muted)'}">${label}</button>`;
  return `<div style="padding:10px 20px 6px;display:flex;gap:4px">${btn('pipeline', 'Pipeline')}${btn('schedule', 'Schedule')}</div>`;
}

function switchRenewalsSubTab(tab) {
  state.renewalsSubTab = tab;
  location.hash = tab === 'pipeline' ? 'acquisition/journey' : 'acquisition/journey/' + tab;
  render();
}

async function renewalDrop(stageKey) {
  clearAllDragOver();
  const id = state.dragId;
  state.dragId = null;
  if (!id) return;
  const to = decodeURIComponent(escape(atob(stageKey)));
  const deal = renewalDeals().find(d => d.id === id);
  if (deal) {
    // A journey card can't become an upsell (or back) by dragging — they're different things.
    if (isUpsellCard(deal) !== UPSELL_IDS.has(to)) { showToast(isUpsellCard(deal) ? 'Upsell cards move between the Upsell columns only.' : 'Add an upsell with "+ Upsell" — the client card stays on the journey.', 'error'); return; }
    const stage = RENEWAL_STAGES.find(s => s.id === to);
    if (!stageFits(stage, deal.company)) {
      showToast(modelOf(deal.company) === 'retainer' ? `${deal.company} is on a retainer — "Active" is for pay-per-meeting clients.` : `${deal.company} is pay-per-meeting — renewals and upsells don't apply to them yet. Use Active.`, 'error');
      return;
    }
  }
  await moveDeal(id, to);
  loadRenewalDates(); // the trigger has logged the move; pick up its date
}

async function renewalAddClient() {
  const name = document.getElementById('renewal-add-client')?.value;
  if (!name) return;
  const c = state.clients.find(x => x.name === name) || {};
  await createRenewalCard({
    contact: [str(c.contactFirstName), str(c.contactLastName)].filter(Boolean).join(' '),
    email: str(c.notifyEmail), phone: str(c.clientPhone),
  }, name);
  render();
}

async function renewalAddUpsell() {
  const name = document.getElementById('upsell-client')?.value;
  const what = str(document.getElementById('upsell-what')?.value).trim();
  if (!name) { showToast('Pick the client the upsell is for.', 'error'); return; }
  if (!what) { showToast("Say what's being offered.", 'error'); return; }
  const from = cardFor(name) || {};
  const card = {
    id: uid(), pipeline: RENEWAL_PIPELINE, stage: UPSELL_STAGES[0].id, flag: '',
    company: str(from.company) || name,
    contact: str(from.contact), email: str(from.email), phone: str(from.phone),
    notes: `Upsell: ${what}`,
    createdDate: getToday(), lastUpdated: getToday(),
  };
  store.addDeal(card);
  try { await sbCreateDeal(camelToSnake(card)); }
  catch (e) { console.error('[upsell] card not created:', e); showToast(`Upsell for ${name} was not saved: ${e?.message || e}`, 'error'); }
  _loadedAt = 0;
  render();
}

window.switchRenewalsSubTab = switchRenewalsSubTab;
window.renewalAddUpsell = renewalAddUpsell;
window.renewalDrop = renewalDrop;
window.renewalAddClient = renewalAddClient;
