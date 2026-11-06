// ═══════════════════════════════════════════════════════════
// HIRING MODAL — a hiring card's detail, deal-modal style (Aidan, 2026-11-06):
// contact fields, stage, follow-ups with due dates, the conversation timeline
// (replies in, messages out, notes, stage moves), Save, Mark Unread, and a
// straight link to the Aimfox conversation for LinkedIn leads.
// Every text field is state-backed (state.hiringDraft) because render()
// rebuilds #app. Clicking outside, ✕ and Close all save pending edits.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261106121450';
import { render } from './render.js?v=20261106121450';
import { showToast } from './api.js?v=20261106121450';
import { esc, str, svgIcon, fmtTimestamp, getToday } from './utils.js?v=20261106121450';
import { STAGES, CONTACT_TYPES, stageLabel, shortDate, replyText, findCandidate, saveFields, moveCandidate, toggleStar } from './hiring.js?v=20261106121450';
import { activitiesFor, loadActivities, addHiringActivity, updateHiringActivity, deleteHiringActivity, findActivity } from './hiring-activity.js?v=20261106121450';
import { refreshHiringUnread } from './hiring-unread.js?v=20261106121450';

const LINK_STYLE = 'color:var(--purple);word-break:break-all';
const INPUT_STYLE = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)';
const SECTION_STYLE = 'border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px';

export const withScheme = (v) => /^https?:\/\//i.test(v) ? v : `https://${v}`;

// Escapes text and makes every URL in it clickable.
function linkify(v) {
  return esc(str(v)).replace(/https?:\/\/[^\s<"]+/gi, (u) => `<a href="${u}" target="_blank" rel="noopener" style="${LINK_STYLE}">${u}</a>`).replace(/\n/g, '<br>');
}

// Editable contact fields; `href` turns a saved value into its link.
const DETAIL_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', href: (v) => `mailto:${v}` },
  { key: 'phone', label: 'Phone / WhatsApp', href: (v) => `https://wa.me/${v.replace(/\D/g, '')}` },
  { key: 'company', label: 'Company' },
  { key: 'location', label: 'Location' },
  { key: 'linkedin', label: 'LinkedIn', href: withScheme },
  { key: 'video_url', label: 'Intro video', href: withScheme, kind: 'applicant' },
];
const fieldsFor = (c) => DETAIL_FIELDS.filter(f => !f.kind || f.kind === c.kind);
const normalize = (key, v) => key === 'email' ? v.trim().toLowerCase() : v.trim();

// ─── Draft (state-backed so a re-render never eats typing) ───
function newDraft(c) {
  const fields = { notes: str(c.notes) };
  fieldsFor(c).forEach(f => { fields[f.key] = str(c[f.key]); });
  return { id: c.id, fields, entry: '', fuSubject: '', fuDue: getToday() };
}

function pendingEdits(c, draft) {
  const out = {};
  for (const [key, raw] of Object.entries(draft.fields)) {
    const v = key === 'notes' ? raw : normalize(key, raw);
    if (v !== str(c[key])) out[key] = v;
  }
  return out;
}

async function savePending() {
  const d = state.hiringDraft;
  const c = d && findCandidate(d.id);
  if (!c) return true;
  const edits = pendingEdits(c, d);
  return Object.keys(edits).length ? saveFields(c, edits) : true;
}

// ─── Sections ───
function fieldsHtml(c, d) {
  return `<div style="display:grid;grid-template-columns:110px 1fr;gap:6px 10px;align-items:center;font-size:12px;margin-bottom:12px">
    ${fieldsFor(c).map(f => {
      const v = str(c[f.key]).trim();
      const open = f.href && v ? `<a href="${esc(f.href(v))}" target="_blank" rel="noopener" title="Open" style="${LINK_STYLE};text-decoration:none;padding:0 4px">↗</a>` : '';
      return `<label style="color:var(--text-muted);font-weight:600">${f.label}</label>
        <div style="display:flex;align-items:center;gap:4px"><input type="text" id="hiring-f-${f.key}" value="${esc(d.fields[f.key])}" placeholder="—"
          oninput="hiringDraftField('${f.key}', this.value)" style="flex:1;min-width:0;${INPUT_STYLE}">${open}</div>`;
    }).join('')}
  </div>`;
}

function controlsHtml(c) {
  const id = esc(c.id);
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:12px;flex-wrap:wrap">
    <select onchange="hiringMove('${id}', this.value)" style="${INPUT_STYLE}">
      ${STAGES[c.kind].map(s => `<option value="${esc(s.id)}" ${s.id === c.stage ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}
    </select>
    <button class="btn btn-ghost" style="font-size:12px;color:${c.starred ? '#f59e0b' : 'var(--text-muted)'}" onclick="hiringToggleStar('${id}')">★ ${c.starred ? 'Starred' : 'Star'}</button>
    ${c.kind === 'partner' ? `<select onchange="hiringSetContactType('${id}', this.value)" style="${INPUT_STYLE}">
      ${Object.entries(CONTACT_TYPES).map(([k, t]) => `<option value="${k}" ${k === (c.contact_type || '') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
    </select>` : ''}
    <span style="color:var(--text-muted)">${c.invite_sent_at ? `Interview invite sent ${esc(shortDate(c.invite_sent_at))}` : ''}</span>
  </div>`;
}

// Where the conversation actually lives: Aimfox for LinkedIn, SmartLead for email.
function conversationLinksHtml(c) {
  const links = [
    c.aimfox_conversation_url && ['Open LinkedIn conversation in Aimfox', c.aimfox_conversation_url, '#0a66c2', '#eff6ff'],
    c.answers?.smartlead && ['Open email thread in SmartLead', c.answers.smartlead, '#7c3aed', '#f5f3ff'],
  ].filter(Boolean);
  return links.map(([label, href, color, bg]) => `<a href="${esc(href)}" target="_blank" rel="noopener" class="btn" style="font-size:12px;text-decoration:none;color:${color};background:${bg};border:1px solid ${color}33;margin:0 6px 12px 0;display:inline-flex">${esc(label)} ↗</a>`).join('');
}

function answersHtml(c) {
  const answers = Object.entries(c.answers || {}).filter(([q, v]) => !['reply', 'smartlead', 'channel'].includes(q) && str(v));
  if (!answers.length) return '';
  return `<details style="${SECTION_STYLE}" ${c.kind === 'applicant' ? 'open' : ''}><summary style="font-weight:700;cursor:pointer">${c.kind === 'applicant' ? 'Application answers' : 'Details'} (${answers.length})</summary>
    <div style="max-height:260px;overflow-y:auto;margin-top:8px;line-height:1.5">
      ${answers.map(([q, a]) => `<div style="margin-bottom:8px"><div style="font-weight:600;color:var(--text-muted)">${esc(q)}</div><div>${linkify(a)}</div></div>`).join('')}
    </div></details>`;
}

function followUpRow(a) {
  const today = getToday();
  const due = str(a.due_at).slice(0, 10);
  const color = due && due < today ? '#ef4444' : due === today ? '#059669' : '#6b7280';
  const ids = `'${esc(a.candidate_id)}','${esc(a.id)}'`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
    <input type="checkbox" onchange="hiringFollowUpDone(${ids})">
    <span style="flex:1">${esc(a.body)}</span>
    <input type="date" value="${esc(due)}" onchange="hiringFollowUpDue(${ids}, this.value)" style="border:none;background:none;font-size:11px;color:${color};font-family:var(--font)">
    <button onclick="hiringActivityDelete(${ids})" title="Delete" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:14px">×</button>
  </div>`;
}

function followUpsHtml(c, d, rows) {
  const fus = rows.filter(a => a.type === 'followup');
  const pending = fus.filter(a => !a.done_at).sort((a, b) => str(a.due_at).localeCompare(str(b.due_at)));
  const done = fus.filter(a => a.done_at);
  return `<div style="${SECTION_STYLE}">
    <div style="font-weight:700;margin-bottom:6px">Follow-ups</div>
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input type="text" id="hiring-fu-subject" placeholder="Next step, e.g. Send the intake form" value="${esc(d.fuSubject)}" oninput="hiringDraftSet('fuSubject', this.value)" style="flex:1;${INPUT_STYLE}">
      <input type="date" id="hiring-fu-due" value="${esc(d.fuDue)}" oninput="hiringDraftSet('fuDue', this.value)" style="${INPUT_STYLE}">
      <button class="btn btn-primary" style="font-size:12px" onclick="hiringFollowUpAdd('${esc(c.id)}')">+ Add</button>
    </div>
    ${pending.length ? pending.map(followUpRow).join('') : '<div style="color:var(--text-muted)">No follow-ups scheduled</div>'}
    ${done.length ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--text-muted)">Completed (${done.length})</summary>
      ${done.map(a => `<div style="padding:3px 0;color:var(--text-muted)">✓ ${esc(a.body)} <span style="font-size:10px">${esc(fmtTimestamp(a.done_at))}</span></div>`).join('')}</details>` : ''}
  </div>`;
}

const ENTRY_LABEL = {
  reply_in: (a) => `📥 Reply${a.channel ? ' · ' + a.channel : ''}`,
  message_out: (a) => `📤 Message sent${a.channel ? ' · ' + a.channel : ''}`,
  note: () => '📝 Note',
  stage: (a) => `➡️ Moved to ${a.body}`,
  followup: (a) => `✅ Follow-up done: ${a.body}`,
};

// Newest first. Follow-ups appear once done; the card's arrival anchors the end.
function timelineEvents(c, rows) {
  const events = rows.filter(a => a.type !== 'followup' || a.done_at)
    .map(a => ({ at: a.type === 'followup' ? a.done_at : a.created_at, label: ENTRY_LABEL[a.type](a), body: ['stage', 'followup'].includes(a.type) ? '' : replyText(a.body) }));
  events.push({ at: c.applied_at || c.created_at, label: c.kind === 'applicant' ? '📋 Applied' : '🆕 Card created', body: '' });
  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function timelineHtml(c, d, rows) {
  const events = timelineEvents(c, rows);
  return `<div style="${SECTION_STYLE}">
    <div style="font-weight:700;margin-bottom:6px">Timeline (${events.length})</div>
    <textarea id="hiring-entry" placeholder="Add a note, or paste a message you sent" oninput="hiringDraftSet('entry', this.value)"
      style="width:100%;min-height:48px;${INPUT_STYLE};resize:vertical">${esc(d.entry)}</textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin:6px 0 8px">
      <button class="btn btn-ghost" style="font-size:12px" onclick="hiringLogEntry('${esc(c.id)}','note')">📝 Log note</button>
      <button class="btn btn-ghost" style="font-size:12px" onclick="hiringLogEntry('${esc(c.id)}','message_out')">📤 Log message sent</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;border-left:2px solid #d1d5db;margin-left:6px;padding-left:12px">
      ${events.map(e => `<div style="margin-bottom:8px">
        <div><b>${esc(e.label)}</b> <span style="color:#9ca3af;margin-left:4px">${esc(fmtTimestamp(e.at))}</span></div>
        ${e.body ? `<div style="line-height:1.5;margin-top:2px">${linkify(e.body)}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}

export function renderHiringModal() {
  const c = state.hiringOpenId ? findCandidate(state.hiringOpenId) : null;
  const d = state.hiringDraft;
  if (!c || !d) return '';
  const rows = activitiesFor(c.id);
  const id = esc(c.id);
  return `<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this)hiringClose()">
    <div class="modal" style="width:640px;max-width:95vw" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>${esc(c.name || c.email)} ${c.kind === 'partner' ? '<span class="deal-tag" style="background:#ecfeff;color:#0e7490">Partner</span>' : ''}</h3>
        <button class="modal-close" onclick="hiringClose()">×</button></div>
      <div class="modal-body">
        ${conversationLinksHtml(c)}
        ${fieldsHtml(c, d)}
        ${controlsHtml(c)}
        ${rows ? followUpsHtml(c, d, rows) + timelineHtml(c, d, rows) : `<div style="${SECTION_STYLE};color:var(--text-muted)">Loading timeline…</div>`}
        ${answersHtml(c)}
        <textarea id="hiring-notes" placeholder="Notes" oninput="hiringDraftField('notes', this.value)"
          style="width:100%;min-height:60px;${INPUT_STYLE};font-size:13px;resize:vertical">${esc(d.fields.notes)}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;font-size:12px" onclick="hiringMarkUnread('${id}')" title="Mark as unread so the blue highlight comes back">${svgIcon('mail', 12, '#2563eb')} Mark Unread</button>
        <div style="display:flex;gap:8px">
          <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="hiringClose()">Close</button>
          <button class="btn btn-primary" onclick="hiringSave()">Save</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Open / close ───
export function openHiringCard(id) {
  const c = findCandidate(id);
  if (!c) return;
  state.hiringOpenId = id;
  state.hiringDraft = newDraft(c);
  if (c.has_new_activity) saveFields(c, { has_new_activity: false }).then(refreshHiringUnread);
  loadActivities(id).then(() => { if (state.hiringOpenId === id) render(); });
  render();
}

async function closeHiringCard() {
  const ok = await savePending();
  if (!ok) return false; // keep the modal open so the edit is not lost
  state.hiringOpenId = null;
  state.hiringDraft = null;
  render();
  return true;
}

// ─── Handlers (inline onclick: data-action does not survive inside modals) ───
window.hiringDraftField = (key, v) => { if (state.hiringDraft) state.hiringDraft.fields[key] = v; };
window.hiringDraftSet = (key, v) => { if (state.hiringDraft) state.hiringDraft[key] = v; };
window.hiringClose = () => closeHiringCard();
window.hiringSave = async () => { if (await closeHiringCard()) showToast('Saved', 'success'); };
window.hiringMarkUnread = async (id) => {
  const c = findCandidate(id);
  if (!c || !(await closeHiringCard())) return;
  await saveFields(c, { has_new_activity: true });
  refreshHiringUnread();
};
window.hiringMove = (id, stage) => moveCandidate(id, stage);
window.hiringToggleStar = (id) => toggleStar(id);
window.hiringSetContactType = (id, v) => { const c = findCandidate(id); if (c) saveFields(c, { contact_type: v || null }); };

window.hiringLogEntry = async (id, type) => {
  const d = state.hiringDraft;
  const body = str(d?.entry).trim();
  if (!body) { showToast('Type the note or message first'); return; }
  const c = findCandidate(id);
  const channel = type === 'message_out' ? (c?.answers?.channel || '') : '';
  if (await addHiringActivity(id, { type, body, channel })) { d.entry = ''; render(); }
};
window.hiringFollowUpAdd = async (id) => {
  const d = state.hiringDraft;
  const body = str(d?.fuSubject).trim();
  if (!body || !d.fuDue) { showToast('Add what the follow-up is and its due date'); return; }
  if (await addHiringActivity(id, { type: 'followup', body, due_at: d.fuDue })) { d.fuSubject = ''; render(); }
};
async function withActivity(cid, id, write) {
  const a = findActivity(cid, id);
  if (!a) return;
  await write(a);
  render();
}
window.hiringFollowUpDone = (cid, id) => withActivity(cid, id, a => updateHiringActivity(a, { done_at: new Date().toISOString() }));
window.hiringFollowUpDue = (cid, id, due) => due && withActivity(cid, id, a => updateHiringActivity(a, { due_at: due }));
window.hiringActivityDelete = (cid, id) => withActivity(cid, id, deleteHiringActivity);
