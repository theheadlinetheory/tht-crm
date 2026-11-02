// ═══════════════════════════════════════════════════════════
// HIRING — admin-only board for people we might hire, not sell to
// (Aidan, 2026-11-02). Replaces the SDR applications sheet.
//
// Rows live in `hiring_candidates` (tht-crm-backend migration
// 20261102_hiring_candidates.sql), never `deals`, so candidates stay out of
// Acquisition, the Funnel and reply checking. RLS lets admins only.
// - Applicants: hiring-intake copies new application-form rows in every 15 min.
// - Partners: replies to the "Recruiting Partners" SmartLead campaigns, routed
//   here by smartlead-webhook.
// Landing an applicant on Interviewing emails the interview invite once
// (hiring-invite), exactly as the old sheet script did.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261102071028';
import { render } from './render.js?v=20261102071028';
import { supabase } from './supabase-client.js?v=20261102071028';
import { showToast } from './api.js?v=20261102071028';
import { esc, str } from './utils.js?v=20261102071028';

const STAGES = [
  { id: 'Partner Replies', color: '#0891b2' },
  { id: 'Applied', color: '#64748b' },
  { id: 'Shortlist', color: '#8b5cf6' },
  { id: 'Interviewing', color: '#2563eb' },
  { id: 'Final Round', color: '#d97706' },
  { id: 'Hired', color: '#059669' },
  { id: 'Not a Fit', color: '#9ca3af' },
];
const INVITE_STAGE = 'Interviewing';
const STALE_MS = 60000;

let _candidates = [];
let _status = 'idle'; // idle | loading | ready | error
let _loadedAt = 0;

async function loadCandidates() {
  _status = 'loading';
  try {
    const PAGE = 1000;
    let all = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase.from('hiring_candidates').select('*')
        .order('applied_at', { ascending: false, nullsFirst: false }).range(off, off + PAGE - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < PAGE) break;
    }
    _candidates = all;
    _status = 'ready';
  } catch (e) {
    _status = 'error';
    console.warn('[hiring] load failed:', e?.message || e);
  }
  _loadedAt = Date.now();
  render();
}

const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const find = (id) => _candidates.find(c => c.id === id);

function visibleCandidates() {
  const q = str(state.hiringSearch).trim().toLowerCase();
  return _candidates.filter(c =>
    (!state.hiringStarredOnly || c.starred) &&
    (!q || [c.name, c.email, c.company, c.location, c.source].some(v => str(v).toLowerCase().includes(q))));
}

// ─── Board ───
function cardHtml(c) {
  const tags = [
    c.kind === 'partner' ? '<span class="deal-tag" style="background:#ecfeff;color:#0e7490">Partner</span>' : '',
    c.location ? `<span class="deal-tag">${esc(c.location)}</span>` : '',
    c.applied_at ? `<span class="deal-tag" style="background:#f1f5f9;color:#475569">${esc(shortDate(c.applied_at))}</span>` : '',
    c.invite_sent_at ? '<span class="deal-tag" style="background:#eff6ff;color:#1d4ed8">Invite sent</span>' : '',
  ].join('');
  return `<div class="deal-card" draggable="true"
      ondragstart="event.dataTransfer.effectAllowed='move';hiringDragStart('${esc(c.id)}')"
      ondragend="clearAllDragOver()"
      ondragover="event.preventDefault();doDragOver(this.closest('.column'))"
      onclick="hiringOpen('${esc(c.id)}')">
    <div class="deal-card-top">
      <div class="deal-company">${esc(c.name || c.email || 'Unknown')}</div>
      <span onclick="event.stopPropagation();hiringToggleStar('${esc(c.id)}')" title="Strong candidate" style="cursor:pointer;font-size:14px;color:${c.starred ? '#f59e0b' : '#d1d5db'}">★</span>
    </div>
    ${c.company ? `<div class="deal-detail">${esc(c.company)}</div>` : ''}
    <div class="deal-bottom"><span style="display:flex;gap:4px;flex-wrap:wrap">${tags}</span></div>
  </div>`;
}

function toolbarHtml(total) {
  return `<div style="padding:12px 20px 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-muted)">
    <span>${total} ${total === 1 ? 'person' : 'people'} · drag a card to move it · new form applications arrive every 15 min</span>
    ${_status === 'error' ? '<span style="color:#b91c1c">Could not load the board.</span>' : ''}
    <span style="flex:1"></span>
    <input type="text" placeholder="Search name, email, country…" value="${esc(str(state.hiringSearch))}"
      onchange="hiringSearch(this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);width:200px">
    <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
      <input type="checkbox" ${state.hiringStarredOnly ? 'checked' : ''} onchange="hiringStarredOnly(this.checked)"> ★ only
    </label>
  </div>`;
}

export function renderHiring() {
  if (_status !== 'loading' && Date.now() - _loadedAt > STALE_MS) loadCandidates();
  if (_status === 'loading' && !_candidates.length) {
    return '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading candidates…</div>';
  }
  const list = visibleCandidates();
  let html = toolbarHtml(list.length) + '<div class="board">';
  for (const stage of STAGES) {
    const sc = list.filter(c => c.stage === stage.id);
    const key = encodeURIComponent(stage.id);
    html += `<div class="column" ondragover="event.preventDefault();doDragOver(this)" ondragleave="doDragLeave(event,this)" ondrop="hiringDrop('${key}')">
      <div class="col-header" style="border-top-color:${stage.color}"><div>
        <div class="col-title">${esc(stage.id)}</div>
        <div class="col-meta">${sc.length}</div>
      </div></div>
      <div class="col-body">${sc.length ? sc.map(cardHtml).join('') : '<div class="col-empty">Nobody here</div>'}</div>
    </div>`;
  }
  return html + '</div>' + detailModalHtml();
}

// ─── Detail ───
function linkify(v) {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener" style="color:var(--purple);word-break:break-all">${esc(s)}</a>` : esc(s).replace(/\n/g, '<br>');
}

function detailModalHtml() {
  const c = state.hiringOpenId ? find(state.hiringOpenId) : null;
  if (!c) return '';
  const answers = Object.entries(c.answers || {}).filter(([, v]) => str(v));
  const contact = [
    c.email ? `<a href="mailto:${esc(c.email)}" style="color:var(--purple)">${esc(c.email)}</a>` : '',
    c.phone ? esc(c.phone) : '',
    c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener" style="color:var(--purple)">LinkedIn</a>` : '',
    c.video_url ? `<a href="${esc(c.video_url)}" target="_blank" rel="noopener" style="color:var(--purple)">Intro video</a>` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="modal-overlay">
    <div class="invoice-modal" style="max-width:620px">
      <div class="invoice-header">
        <h3 style="margin:0;font-size:16px">${esc(c.name || c.email)} ${c.kind === 'partner' ? '<span class="deal-tag" style="background:#ecfeff;color:#0e7490">Partner</span>' : ''}</h3>
        <button class="btn btn-ghost" onclick="hiringClose()" style="padding:4px 8px">✕</button>
      </div>
      <div class="invoice-body">
        <div style="font-size:12px;margin-bottom:10px">${contact}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:12px">
          <select onchange="hiringMove('${esc(c.id)}', this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
            ${STAGES.map(s => `<option ${s.id === c.stage ? 'selected' : ''}>${esc(s.id)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost" style="font-size:12px;color:${c.starred ? '#f59e0b' : 'var(--text-muted)'}" onclick="hiringToggleStar('${esc(c.id)}')">★ ${c.starred ? 'Starred' : 'Star'}</button>
          <span style="color:var(--text-muted)">${c.invite_sent_at ? `Interview invite sent ${esc(shortDate(c.invite_sent_at))}` : ''}</span>
        </div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:12px;font-size:12px;line-height:1.5">
          ${answers.length ? answers.map(([q, a]) => `<div style="margin-bottom:8px"><div style="font-weight:600;color:var(--text-muted)">${esc(q)}</div><div>${linkify(a)}</div></div>`).join('') : '<span style="color:var(--text-muted)">No answers on file.</span>'}
        </div>
        <textarea placeholder="Notes" onblur="hiringSaveNotes('${esc(c.id)}', this.value)"
          style="width:100%;min-height:70px;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical">${esc(str(c.notes))}</textarea>
      </div>
    </div>
  </div>`;
}

// ─── Writes ───
async function saveFields(c, fields) {
  const before = { ...c };
  Object.assign(c, fields);
  render();
  const { error } = await supabase.from('hiring_candidates').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', c.id);
  if (error) { Object.assign(c, before); render(); showToast('Save failed: ' + error.message); return false; }
  return true;
}

async function sendInvite(c) {
  const { data, error } = await supabase.functions.invoke('hiring-invite', { body: { candidateId: c.id } });
  if (error || data?.error) { showToast(`Interview invite NOT sent to ${c.name || c.email}: ${error?.message || data.error}`); return; }
  c.invite_sent_at = data.inviteSentAt;
  if (!data.alreadySent) showToast(`Interview invite sent to ${data.sentTo}`, 'success');
  render();
}

async function moveCandidate(id, stage) {
  const c = find(id);
  if (!c || c.stage === stage) return;
  const ok = await saveFields(c, { stage });
  if (ok && stage === INVITE_STAGE && c.kind === 'applicant' && !c.invite_sent_at) await sendInvite(c);
}

window.hiringDragStart = (id) => { state.hiringDragId = id; };
window.hiringDrop = (key) => {
  clearAllDragOver();
  const id = state.hiringDragId;
  state.hiringDragId = null;
  if (id) moveCandidate(id, decodeURIComponent(key));
};
window.hiringMove = (id, stage) => moveCandidate(id, stage);
window.hiringOpen = (id) => { state.hiringOpenId = id; render(); };
window.hiringClose = () => { state.hiringOpenId = null; render(); };
window.hiringToggleStar = (id) => { const c = find(id); if (c) saveFields(c, { starred: !c.starred }); };
window.hiringSaveNotes = (id, notes) => { const c = find(id); if (c && str(c.notes) !== notes) saveFields(c, { notes }); };
window.hiringSearch = (v) => { state.hiringSearch = v; render(); };
window.hiringStarredOnly = (on) => { state.hiringStarredOnly = on; render(); };
