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
// A new applicant or reply flags the card (has_new_activity): blue card here,
// red count on the Hiring tab (hiring-unread.js). The detail modal, timeline
// and follow-ups live in hiring-modal.js / hiring-activity.js.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261108172836';
import { render } from './render.js?v=20261108172836';
import { supabase } from './supabase-client.js?v=20261108172836';
import { showToast } from './api.js?v=20261108172836';
import { candidateChannel, channelPill, channelSelectHtml } from './hiring-channel.js?v=20261108172836';
import { esc, str, svgIcon } from './utils.js?v=20261108172836';
import { renderHiringModal, openHiringCard, withScheme } from './hiring-modal.js?v=20261108172836';
import { addHiringActivity, loadActivities } from './hiring-activity.js?v=20261108172836';
import { onHiringChange } from './hiring-unread.js?v=20261108172836';

// Applicants want a job with us; partners are companies that hire (recruiting
// partners who could send us candidates). Each gets its own board.
// 'Partner Replies' is the stage smartlead-webhook files new replies under.
export const STAGES = {
  applicant: [
    { id: 'Applied', color: '#64748b' },
    { id: 'Shortlist', color: '#8b5cf6' },
    { id: 'Interviewing', color: '#2563eb' },
    { id: 'Final Round', color: '#d97706' },
    { id: 'Hired', color: '#059669' },
    { id: 'Not a Fit', color: '#9ca3af' },
  ],
  partner: [
    { id: 'Partner Replies', label: 'New Reply', color: '#0891b2' },
    { id: 'In Talks', color: '#2563eb' },
    { id: 'Partnered', color: '#059669' },
    { id: 'Passed', color: '#9ca3af' },
  ],
};
const KIND_LABELS = { applicant: 'Applicants', partner: 'Recruiting Partners' };
// Partner replies are either companies that could send us candidates or
// individuals who want the job themselves (contact_type; null = not sorted yet).
export const CONTACT_TYPES = {
  company: { label: '🏢 Company', style: 'background:#ecfdf5;color:#047857' },
  individual: { label: '👤 Individual', style: 'background:#fef3c7;color:#92400e' },
  '': { label: 'Unsorted', style: 'background:#fef2f2;color:#b91c1c' },
};
const contactType = (c) => CONTACT_TYPES[c.contact_type || ''];
export const stageLabel = (s) => s.label || s.id;
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

export const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
export const findCandidate = (id) => _candidates.find(c => c.id === id);

function visibleCandidates() {
  const q = str(state.hiringSearch).trim().toLowerCase();
  return _candidates.filter(c =>
    c.kind === state.hiringKind &&
    (!state.hiringStarredOnly || c.starred) &&
    (state.hiringContactType == null || (c.contact_type || '') === state.hiringContactType) &&
    (!state.hiringChannel || candidateChannel(c) === state.hiringChannel) &&
    (!q || [c.name, c.email, c.company, c.location, c.source].some(v => str(v).toLowerCase().includes(q))));
}

// ─── Card content ───
const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton(mail)?)\./i;

// The reply as plain text: email HTML minus quoted history and signature.
export function replyText(raw) {
  const s = str(raw);
  if (!/<[a-z][\s\S]*>/i.test(s)) return s.trim();
  const doc = new DOMParser().parseFromString(s.replace(/<br\b[^>]*>/gi, '\n').replace(/<\/(div|p)>/gi, '\n$&'), 'text/html');
  doc.querySelectorAll('blockquote, .gmail_quote, .gmail_quote_container, .gmail_signature, [class*="quote"], style, head').forEach(n => n.remove());
  return doc.body.textContent.split(/\n\s*On .{4,160}?wrote:|\n\s*--\s|\nSent from my /)[0].replace(/\n{3,}/g, '\n\n').trim();
}

// Company, else the work email's domain, plus the LinkedIn headline title.
function orgLine(c) {
  const org = c.company || (c.email && !FREE_MAIL.test(c.email) ? c.email.split('@')[1] : '');
  return [c.answers?.title, org].filter(Boolean).join(' · ');
}

const answerTo = (c, prefix) => str(Object.entries(c.answers || {}).find(([q]) => q.startsWith(prefix))?.[1]).trim();

function yesNoTag(label, answer) {
  if (!answer) return '';
  const yes = /^y/i.test(answer);
  return `<span class="deal-tag" style="background:${yes ? '#ecfdf5;color:#047857' : '#fef2f2;color:#b91c1c'}" title="${esc(answer)}">${yes ? '✓' : '✗'} ${label}</span>`;
}

function partnerTags(c) {
  const t = contactType(c);
  return [
    `<span class="deal-tag" style="${t.style}">${t.label}</span>`,
    c.answers?.category ? `<span class="deal-tag" style="background:#f5f3ff;color:#6d28d9">${esc(c.answers.category)}</span>` : '',
  ];
}

function applicantTags(c) {
  const start = answerTo(c, 'When are you free to start');
  return [
    start ? `<span class="deal-tag" style="background:#f1f5f9;color:#475569" title="Free to start">Start: ${esc(start.slice(0, 24))}</span>` : '',
    yesNoTag('5 days', answerTo(c, 'Can you commit to working 5 days')),
    yesNoTag('PST', answerTo(c, 'Are you able to work in Pacific')),
    c.video_url ? `<a class="deal-tag" href="${esc(c.video_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:#fdf4ff;color:#a21caf;text-decoration:none">▶ Loom</a>` : '',
  ];
}

function previewHtml(c) {
  const text = c.kind === 'partner' ? replyText(c.answers?.reply).replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin:2px 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">“${esc(text)}”</div>`;
}

// ─── Board ───
function cardHtml(c) {
  const tags = [
    ...(c.kind === 'partner' ? partnerTags(c) : applicantTags(c)),
    c.linkedin ? `<a class="deal-tag" href="${esc(withScheme(c.linkedin))}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:#eff6ff;color:#0a66c2;text-decoration:none">in LinkedIn ↗</a>` : '',
    c.applied_at ? `<span class="deal-tag" style="background:#f1f5f9;color:#475569">${esc(shortDate(c.applied_at))}</span>` : '',
    c.invite_sent_at ? '<span class="deal-tag" style="background:#eff6ff;color:#1d4ed8">Invite sent</span>' : '',
  ].join('');
  const isNew = c.has_new_activity;
  return `<div class="deal-card${isNew ? ' has-reply' : ''}" draggable="true"
      ondragstart="event.dataTransfer.effectAllowed='move';hiringDragStart('${esc(c.id)}')"
      ondragend="clearAllDragOver()"
      ondragover="event.preventDefault();doDragOver(this.closest('.column'))"
      onclick="hiringOpen('${esc(c.id)}')">
    <div class="deal-card-top">
      <div class="deal-company">${channelPill(c)}${isNew ? `<span class="reply-indicator" title="${c.kind === 'applicant' ? 'New applicant' : 'New reply'}">${svgIcon('mail', 12, '#3b82f6')}</span>` : ''}${esc(c.name || c.email || 'Unknown')}</div>
      <span onclick="event.stopPropagation();hiringToggleStar('${esc(c.id)}')" title="Strong candidate" style="cursor:pointer;font-size:14px;color:${c.starred ? '#f59e0b' : '#d1d5db'}">★</span>
    </div>
    ${orgLine(c) ? `<div class="deal-detail">${esc(orgLine(c))}</div>` : ''}
    ${previewHtml(c)}
    <div class="deal-bottom"><span style="display:flex;gap:4px;flex-wrap:wrap">${tags}</span></div>
  </div>`;
}

function kindToggleHtml() {
  return Object.entries(KIND_LABELS).map(([kind, label]) => {
    const on = state.hiringKind === kind;
    const n = _candidates.filter(c => c.kind === kind).length;
    return `<button class="btn ${on ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;padding:5px 10px" onclick="hiringKind('${kind}')">${label} (${n})</button>`;
  }).join('');
}

function contactTypeFilterHtml() {
  if (state.hiringKind !== 'partner') return '';
  const opts = [['', 'All'], ...Object.entries(CONTACT_TYPES).map(([k, t]) => [k, t.label])];
  const cur = state.hiringContactType == null ? 'all' : state.hiringContactType;
  return `<select onchange="hiringContactType(this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    ${opts.map(([k, label], i) => { const v = i === 0 ? 'all' : k; return `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}
  </select>`;
}

function toolbarHtml(total) {
  const hint = state.hiringKind === 'partner'
    ? 'email + LinkedIn replies to the Recruiting Partners campaigns'
    : 'new form applications arrive every 15 min';
  return `<div style="padding:12px 20px 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-muted)">
    ${kindToggleHtml()}
    <span>${total} ${total === 1 ? 'card' : 'cards'} · drag a card to move it · ${hint}</span>
    ${_status === 'error' ? '<span style="color:#b91c1c">Could not load the board.</span>' : ''}
    <span style="flex:1"></span>
    ${channelSelectHtml(state.hiringChannel || 'all', 'hiringChannel(this.value)', true)}
    ${contactTypeFilterHtml()}
    <input type="text" placeholder="Search name, email, country…" value="${esc(str(state.hiringSearch))}"
      onchange="hiringSearch(this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);width:200px">
    <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
      <input type="checkbox" ${state.hiringStarredOnly ? 'checked' : ''} onchange="hiringStarredOnly(this.checked)"> ★ only
    </label>
  </div>`;
}

// A webhook reply or new applicant lands live: reload the board, and the open
// card's timeline. The modal's typing is state-backed, so nothing is lost.
// Registered on first render (not at import) so the module cycle with
// hiring-modal.js can never touch hiring-unread.js before it has loaded.
let _watching = false;
function watchChanges() {
  if (_watching) return;
  _watching = true;
  onHiringChange(() => {
    _loadedAt = 0;
    if (state.pipeline !== 'hiring') return;
    if (_status !== 'loading') loadCandidates();
    const openId = state.hiringOpenId;
    if (openId) loadActivities(openId).then(() => { if (state.hiringOpenId === openId) render(); });
  });
}

export function renderHiring() {
  watchChanges();
  if (_status !== 'loading' && Date.now() - _loadedAt > STALE_MS) loadCandidates();
  if (_status === 'loading' && !_candidates.length) {
    return '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading candidates…</div>';
  }
  const list = visibleCandidates();
  let html = toolbarHtml(list.length) + '<div class="board">';
  for (const stage of STAGES[state.hiringKind]) {
    const sc = list.filter(c => c.stage === stage.id);
    const key = encodeURIComponent(stage.id);
    html += `<div class="column" ondragover="event.preventDefault();doDragOver(this)" ondragleave="doDragLeave(event,this)" ondrop="hiringDrop('${key}')">
      <div class="col-header" style="border-top-color:${stage.color}"><div>
        <div class="col-title">${esc(stageLabel(stage))}</div>
        <div class="col-meta">${sc.length}</div>
      </div></div>
      <div class="col-body">${sc.length ? sc.map(cardHtml).join('') : '<div class="col-empty">Nobody here</div>'}</div>
    </div>`;
  }
  return html + '</div>' + renderHiringModal();
}

// ─── Writes ───
export async function saveFields(c, fields) {
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

export async function moveCandidate(id, stage) {
  const c = findCandidate(id);
  if (!c || c.stage === stage) return;
  const ok = await saveFields(c, { stage });
  if (ok) addHiringActivity(c.id, { type: 'stage', body: stage }).then(() => render());
  if (ok && stage === INVITE_STAGE && c.kind === 'applicant' && !c.invite_sent_at) await sendInvite(c);
}

window.hiringDragStart = (id) => { state.hiringDragId = id; };
window.hiringDrop = (key) => {
  clearAllDragOver();
  const id = state.hiringDragId;
  state.hiringDragId = null;
  if (id) moveCandidate(id, decodeURIComponent(key));
};
export function toggleStar(id) { const c = findCandidate(id); if (c) saveFields(c, { starred: !c.starred }); }
window.hiringOpen = (id) => openHiringCard(id);
window.hiringKind = (kind) => { state.hiringKind = kind; render(); };
window.hiringContactType = (v) => { state.hiringContactType = v === 'all' ? null : v; render(); };
window.hiringChannel = (v) => { state.hiringChannel = v === 'all' ? null : v; render(); };
window.hiringSearch = (v) => { state.hiringSearch = v; render(); };
window.hiringStarredOnly = (on) => { state.hiringStarredOnly = on; render(); };
