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
import { state } from './app.js?v=20261106075114';
import { render } from './render.js?v=20261106075114';
import { supabase } from './supabase-client.js?v=20261106075114';
import { showToast } from './api.js?v=20261106075114';
import { esc, str } from './utils.js?v=20261106075114';

// Applicants want a job with us; partners are companies that hire (recruiting
// partners who could send us candidates). Each gets its own board.
// 'Partner Replies' is the stage smartlead-webhook files new replies under.
const STAGES = {
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
const CONTACT_TYPES = {
  company: { label: '🏢 Company', style: 'background:#ecfdf5;color:#047857' },
  individual: { label: '👤 Individual', style: 'background:#fef3c7;color:#92400e' },
  '': { label: 'Unsorted', style: 'background:#fef2f2;color:#b91c1c' },
};
const contactType = (c) => CONTACT_TYPES[c.contact_type || ''];
const stageLabel = (s) => s.label || s.id;
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
    c.kind === state.hiringKind &&
    (!state.hiringStarredOnly || c.starred) &&
    (state.hiringContactType == null || (c.contact_type || '') === state.hiringContactType) &&
    (!q || [c.name, c.email, c.company, c.location, c.source].some(v => str(v).toLowerCase().includes(q))));
}

// ─── Card content ───
const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton(mail)?)\./i;

// The reply as plain text: email HTML minus quoted history and signature.
function replyText(raw) {
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
  const linkedin = c.answers?.channel === 'LinkedIn';
  return [
    `<span class="deal-tag" style="${t.style}">${t.label}</span>`,
    `<span class="deal-tag" style="background:#eff6ff;color:#0a66c2">${linkedin ? 'in LinkedIn' : '✉ Email'}</span>`,
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
  return `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin:4px 0 6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">“${esc(text)}”</div>`;
}

// ─── Board ───
function cardHtml(c) {
  const tags = [
    ...(c.kind === 'partner' ? partnerTags(c) : applicantTags(c)),
    c.linkedin ? `<a class="deal-tag" href="${esc(withScheme(c.linkedin))}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:#eff6ff;color:#0a66c2;text-decoration:none">LinkedIn ↗</a>` : '',
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
    ${contactTypeFilterHtml()}
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
  return html + '</div>' + detailModalHtml();
}

// ─── Detail ───
const LINK_STYLE = 'color:var(--purple);word-break:break-all';

// Escapes text and makes every URL in it clickable.
function linkify(v) {
  return esc(str(v)).replace(/https?:\/\/[^\s<"]+/gi, (u) => `<a href="${u}" target="_blank" rel="noopener" style="${LINK_STYLE}">${u}</a>`).replace(/\n/g, '<br>');
}

// Editable contact fields; `href` turns a saved value into its link.
const withScheme = (v) => /^https?:\/\//i.test(v) ? v : `https://${v}`;
const DETAIL_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', href: (v) => `mailto:${v}` },
  { key: 'phone', label: 'Phone / WhatsApp', href: (v) => `https://wa.me/${v.replace(/\D/g, '')}` },
  { key: 'company', label: 'Company' },
  { key: 'location', label: 'Location' },
  { key: 'linkedin', label: 'LinkedIn', href: withScheme },
  { key: 'video_url', label: 'Intro video', href: withScheme, kind: 'applicant' },
];

function detailFieldsHtml(c) {
  const inputStyle = 'flex:1;min-width:0;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)';
  return `<div style="display:grid;grid-template-columns:110px 1fr;gap:6px 10px;align-items:center;font-size:12px;margin-bottom:12px">
    ${DETAIL_FIELDS.filter(f => !f.kind || f.kind === c.kind).map(f => {
      const v = str(c[f.key]).trim();
      const open = f.href && v ? `<a href="${esc(f.href(v))}" target="_blank" rel="noopener" title="Open" style="${LINK_STYLE};text-decoration:none;padding:0 4px">↗</a>` : '';
      return `<label style="color:var(--text-muted);font-weight:600">${f.label}</label>
        <div style="display:flex;align-items:center;gap:4px"><input type="text" data-keep-focus="1" value="${esc(v)}" placeholder="—"
          onchange="hiringSaveField('${esc(c.id)}', '${f.key}', this.value)" onblur="setTimeout(hiringRefresh)" style="${inputStyle}">${open}</div>`;
    }).join('')}
  </div>`;
}

function detailModalHtml() {
  const c = state.hiringOpenId ? find(state.hiringOpenId) : null;
  if (!c) return '';
  const answers = Object.entries(c.answers || {})
    .map(([q, v]) => q === 'reply' ? ['Reply', replyText(v)] : [q, v])
    .filter(([, v]) => str(v));
  return `<div class="modal-overlay">
    <div class="invoice-modal" style="max-width:620px">
      <div class="invoice-header">
        <h3 style="margin:0;font-size:16px">${esc(c.name || c.email)} ${c.kind === 'partner' ? '<span class="deal-tag" style="background:#ecfeff;color:#0e7490">Partner</span>' : ''}</h3>
        <button class="btn btn-ghost" onclick="hiringClose()" style="padding:4px 8px">✕</button>
      </div>
      <div class="invoice-body">
        ${detailFieldsHtml(c)}
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:12px">
          <select onchange="hiringMove('${esc(c.id)}', this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
            ${STAGES[c.kind].map(s => `<option value="${esc(s.id)}" ${s.id === c.stage ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}
          </select>
          <button class="btn btn-ghost" style="font-size:12px;color:${c.starred ? '#f59e0b' : 'var(--text-muted)'}" onclick="hiringToggleStar('${esc(c.id)}')">★ ${c.starred ? 'Starred' : 'Star'}</button>
          ${c.kind === 'partner' ? `<select onchange="hiringSetContactType('${esc(c.id)}', this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
            ${Object.entries(CONTACT_TYPES).map(([k, t]) => `<option value="${k}" ${k === (c.contact_type || '') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
          </select>` : ''}
          <span style="color:var(--text-muted)">${c.invite_sent_at ? `Interview invite sent ${esc(shortDate(c.invite_sent_at))}` : ''}</span>
        </div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:12px;font-size:12px;line-height:1.5">
          ${answers.length ? answers.map(([q, a]) => `<div style="margin-bottom:8px"><div style="font-weight:600;color:var(--text-muted)">${esc(q)}</div><div>${linkify(a)}</div></div>`).join('') : '<span style="color:var(--text-muted)">No answers on file.</span>'}
        </div>
        <textarea placeholder="Notes" data-keep-focus="1" onblur="hiringSaveNotes('${esc(c.id)}', this.value)"
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
window.hiringRefresh = () => render();
window.hiringSaveField = (id, key, value) => {
  const c = find(id);
  const v = key === 'email' ? value.trim().toLowerCase() : value.trim();
  if (c && str(c[key]) !== v) saveFields(c, { [key]: v });
};
window.hiringSaveNotes =(id, notes) => { const c = find(id); if (c && str(c.notes) !== notes) saveFields(c, { notes }); };
window.hiringKind = (kind) => { state.hiringKind = kind; render(); };
window.hiringContactType = (v) => { state.hiringContactType = v === 'all' ? null : v; render(); };
window.hiringSetContactType = (id, v) => { const c = find(id); if (c) saveFields(c, { contact_type: v || null }); };
window.hiringSearch = (v) => { state.hiringSearch = v; render(); };
window.hiringStarredOnly = (on) => { state.hiringStarredOnly = on; render(); };
