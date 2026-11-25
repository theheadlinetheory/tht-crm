// ═══════════════════════════════════════════════════════════
// HIRING SCORECARD — post-interview thoughts (Aidan, 2026-11-24).
// Moving an applicant to Interviewed opens a short scorecard: an overall 1–5,
// four 1–5 ratings, notes and a Hire / Maybe / No verdict. It's saved on the
// card (hiring_candidates.scorecard), shows as a tag, sorts the Interviewed
// column best-first, and can be edited later from the card modal.
// Interview times come from Calendly (hiring-interview-sync, backend).
// ═══════════════════════════════════════════════════════════
import { render } from './render.js?v=20261125121741';
import { esc, escAttr, jsArg, safeUrl } from './utils.js?v=20261125121741';
import { findCandidate, applyMove, saveFields } from './hiring.js?v=20261125121741';
import { addHiringActivity } from './hiring-activity.js?v=20261125121741';

export const INTERVIEWED_STAGE = 'Interviewed';
export const BOOKED_STAGE = 'Interview Booked';
const RATINGS = ['English', 'Energy', 'Phone presence', 'Coachability'];
const VERDICTS = {
  Hire: { bg: '#ecfdf5', fg: '#047857' },
  Maybe: { bg: '#fffbeb', fg: '#b45309' },
  No: { bg: '#fef2f2', fg: '#b91c1c' },
};
const INPUT = 'width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);box-sizing:border-box';

// { id, moveTo, card: {overall, English, …, verdict, notes} }
let _box = null;

export const needsScorecard = (c, stage) => c.kind === 'applicant' && stage === INTERVIEWED_STAGE;

export function openScorecard(id, moveTo = null) {
  const c = findCandidate(id);
  if (!c) return;
  _box = { id, moveTo, card: { notes: '', ...(c.scorecard || {}) } };
  render();
}

// Interviewed column: best overall score first, unscored last.
export const byScore = (a, b) => (b.scorecard?.overall || 0) - (a.scorecard?.overall || 0);

function summaryLine(sc) {
  const parts = RATINGS.filter(r => sc[r]).map(r => `${r} ${sc[r]}`);
  return [`Overall ${sc.overall || '–'}/5`, sc.verdict, parts.join(' · ')].filter(Boolean).join(' — ');
}

async function saveBox() {
  const box = _box;
  if (!box) return;
  _box = null;
  const c = findCandidate(box.id);
  if (!c) return render();
  const card = { ...box.card, at: new Date().toISOString() };
  if (box.moveTo && c.stage !== box.moveTo) await applyMove(c, box.moveTo);
  if (await saveFields(c, { scorecard: card })) {
    await addHiringActivity(c.id, { type: 'note', body: `Interview scorecard: ${summaryLine(card)}${card.notes ? `\n\n${card.notes}` : ''}` });
  }
  render();
}

async function skipBox() {
  const box = _box;
  _box = null;
  const c = box && findCandidate(box.id);
  if (c && box.moveTo && c.stage !== box.moveTo) await applyMove(c, box.moveTo);
  render();
}

function pickerHtml(key, value) {
  return `<div style="display:flex;gap:4px">${[1, 2, 3, 4, 5].map(n =>
    `<button class="btn" onclick="hiringScore(${jsArg(key)}, ${n})" style="width:34px;padding:6px 0;font-weight:700;border-radius:6px;border:1.5px solid ${n === value ? '#7c3aed' : 'var(--border)'};background:${n === value ? '#7c3aed' : '#fff'};color:${n === value ? '#fff' : 'var(--text)'}">${n}</button>`).join('')}</div>`;
}

export function renderScorecardBox() {
  if (!_box) return '';
  const c = findCandidate(_box.id);
  if (!c) return '';
  const sc = _box.card;
  const row = (label, key, big) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
    <span style="font-weight:${big ? 800 : 600}">${esc(label)}</span>${pickerHtml(key, sc[key])}</div>`;
  return `<div class="modal-overlay">
    <div class="modal" style="width:520px;max-width:95vw">
      <div class="modal-header"><h3>How did ${esc(c.name || c.email)}'s interview go?</h3>
        <button class="modal-close" onclick="hiringScoreCancel()">×</button></div>
      <div class="modal-body" style="font-size:13px">
        ${row('Overall', 'overall', true)}
        <div style="border-top:1px solid var(--border);margin:10px 0 10px"></div>
        ${RATINGS.map(r => row(r, r, false)).join('')}
        <div style="font-weight:700;margin:12px 0 6px">Verdict</div>
        <div style="display:flex;gap:6px;margin-bottom:12px">${Object.entries(VERDICTS).map(([v, s]) =>
          `<button class="btn" onclick="hiringScore('verdict', ${jsArg(v)})" style="flex:1;font-weight:800;border-radius:8px;border:2px solid ${s.fg};background:${sc.verdict === v ? s.fg : s.bg};color:${sc.verdict === v ? '#fff' : s.fg}">${v}</button>`).join('')}</div>
        <div style="font-weight:700;margin-bottom:6px">Thoughts</div>
        <textarea oninput="hiringScoreNotes(this.value)" placeholder="What stood out, concerns, how the practice call went…" style="${INPUT};min-height:110px;resize:vertical;line-height:1.5">${esc(sc.notes || '')}</textarea>
      </div>
      <div class="modal-footer">
        ${_box.moveTo ? '<button class="btn btn-ghost" style="font-size:12px" onclick="hiringScoreSkip()">Skip for now</button>' : '<span></span>'}
        <div style="display:flex;gap:8px">
          <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="hiringScoreCancel()">Cancel</button>
          <button class="btn btn-primary" onclick="hiringScoreSave()">Save scorecard</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Card + modal bits ───
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Booked: the interview time. Once it's passed: a nudge to score it.
export function interviewTagHtml(c) {
  if (c.stage !== BOOKED_STAGE || !c.interview_at) return '';
  if (new Date(c.interview_at) > new Date()) return `<span class="deal-tag" style="background:#ecfeff;color:#0e7490">📅 ${esc(fmtWhen(c.interview_at))}</span>`;
  return `<span class="deal-tag" style="background:#fff7ed;color:#c2410c;font-weight:700" title="${esc(fmtWhen(c.interview_at))}">Interview done? Move to Interviewed</span>`;
}

export function scoreTagHtml(c) {
  const sc = c.scorecard;
  if (!sc?.overall && !sc?.verdict) return '';
  const s = VERDICTS[sc.verdict] || { bg: '#f5f3ff', fg: '#6d28d9' };
  return `<span class="deal-tag" style="background:${s.bg};color:${s.fg};font-weight:700">${sc.overall ? `${sc.overall}/5` : ''}${sc.overall && sc.verdict ? ' · ' : ''}${esc(sc.verdict || '')}</span>`;
}

const SCORED_STAGES = [INTERVIEWED_STAGE, 'Ready to Hire', 'Reached Out', 'Contract Sent', 'Hired', 'Not a Fit'];

// The Fathom recording of the interview (share link, anyone can view).
export const recordingTagHtml = (c) => c.fathom_url
  ? `<a class="deal-tag" href="${escAttr(safeUrl(c.fathom_url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:#f5f3ff;color:#6d28d9;text-decoration:none">🎥 Recording</a>` : '';

function recordingRowHtml(c) {
  return `<div style="display:flex;gap:6px;align-items:center;margin-top:6px">
    ${c.fathom_url ? `<a href="${escAttr(safeUrl(c.fathom_url))}" target="_blank" rel="noopener" style="font-weight:700;color:#6d28d9;white-space:nowrap">🎥 Watch interview</a>` : '<span style="color:var(--text-muted);white-space:nowrap">Fathom link</span>'}
    <input value="${escAttr(c.fathom_url || '')}" placeholder="https://fathom.video/share/…" onchange="hiringSetFathom(${jsArg(c.id)}, this.value)" style="${INPUT};padding:4px 8px;font-size:12px">
  </div>`;
}

// Card modal section: the interview time, the recording, the scorecard, and a button to fill or edit it.
export function scorecardSectionHtml(c) {
  if (c.kind !== 'applicant' || (!c.interview_at && !c.scorecard && !SCORED_STAGES.includes(c.stage))) return '';
  const sc = c.scorecard;
  return `<div style="border:1px solid #ddd6fe;background:#faf5ff;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b style="font-size:13px">Interview</b>
      <button class="btn btn-ghost" style="font-size:12px" onclick="hiringScoreOpen(${jsArg(c.id)})">${sc ? 'Edit scorecard' : 'Fill scorecard'}</button>
    </div>
    ${c.interview_at ? `<div style="color:var(--text-muted);margin-top:2px">📅 ${esc(fmtWhen(c.interview_at))}</div>` : ''}
    ${recordingRowHtml(c)}
    ${sc ? `<div style="margin-top:6px">${scoreTagHtml(c)} ${esc(RATINGS.filter(r => sc[r]).map(r => `${r} ${sc[r]}`).join(' · '))}</div>
      ${sc.notes ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(sc.notes)}</div>` : ''}` : ''}
  </div>`;
}

// ─── Handlers. Notes typing never re-renders, so the cursor stays put. ───
window.hiringScore = (key, v) => { if (_box) { _box.card[key] = _box.card[key] === v ? undefined : v; render(); } };
window.hiringScoreNotes = (v) => { if (_box) _box.card.notes = v; };
window.hiringScoreSave = () => saveBox();
window.hiringScoreSkip = () => skipBox();
window.hiringScoreCancel = () => { _box = null; render(); };
window.hiringScoreOpen = (id) => openScorecard(id);
window.hiringSetFathom = (id, v) => { const c = findCandidate(id); const url = v.trim() || null; if (c && url !== (c.fathom_url || null)) saveFields(c, { fathom_url: url }); };
