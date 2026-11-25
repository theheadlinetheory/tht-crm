// ═══════════════════════════════════════════════════════════
// HIRING BULK — tick several cards (board) or rows (list) and move them at once
// (Aidan, 2026-11-16). Moving to Invited or Not a Fit opens the editable
// email box (hiring-email-box.js) for everyone ticked; other stages just move.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261125121741';
import { render } from './render.js?v=20261125121741';
import { showToast } from './api.js?v=20261125121741';
import { esc, jsArg } from './utils.js?v=20261125121741';
import { STAGES, stageLabel, findCandidate, applyMove } from './hiring.js?v=20261125121741';
import { STAGE_EMAILS, REJECT_STAGE, openEmailBox } from './hiring-email-box.js?v=20261125121741';

const _selected = new Set();

export const isTicked = (id) => _selected.has(id);

// Drops ticks for people no longer on screen (filters, other board).
export function pruneTicks(visible) {
  const ids = new Set(visible.map(c => c.id));
  for (const id of _selected) if (!ids.has(id)) _selected.delete(id);
}

export function tickBoxHtml(c) {
  return `<input type="checkbox" title="Select" ${_selected.has(c.id) ? 'checked' : ''}
    onclick="event.stopPropagation()" onchange="hiringTick(${jsArg(c.id)}, this.checked)"
    style="width:16px;height:16px;cursor:pointer;flex-shrink:0;margin:0 6px 0 0">`;
}

export function bulkBarHtml() {
  const n = _selected.size;
  if (!n) return '';
  const stages = STAGES[state.hiringKind];
  return `<div style="margin:0 20px 8px;padding:8px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px">
    <b>${n} selected</b>
    <select onchange="if(this.value)hiringBulkMove(this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      <option value="">Move to…</option>
      ${stages.map(s => `<option value="${esc(s.id)}">${esc(stageLabel(s))}${STAGE_EMAILS[s.id] && state.hiringKind === 'applicant' ? ' (+ email)' : ''}</option>`).join('')}
    </select>
    ${state.hiringKind === 'applicant' ? `<button class="btn" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:13px;font-weight:700" onclick="hiringBulkMove(${jsArg(REJECT_STAGE)})">Not a Fit + email</button>` : ''}
    <button class="btn btn-ghost" style="font-size:13px" onclick="hiringTickClear()">Clear</button>
  </div>`;
}

async function bulkMove(stage) {
  const ids = [..._selected];
  // Ticks stay until the email box is confirmed, so Cancel doesn't lose them.
  if (STAGE_EMAILS[stage] && state.hiringKind === 'applicant') { openEmailBox(ids, stage, () => _selected.clear()); return; }
  _selected.clear();
  render();
  const people = ids.map(findCandidate).filter(c => c && c.stage !== stage);
  for (const c of people) await applyMove(c, stage);
  showToast(`Moved ${people.length} to ${stage}`, 'success');
}

window.hiringTick = (id, on) => { if (on) _selected.add(id); else _selected.delete(id); render(); };
window.hiringTickClear = () => { _selected.clear(); render(); };
window.hiringBulkMove = (stage) => bulkMove(stage);
