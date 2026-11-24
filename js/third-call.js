// ═══════════════════════════════════════════════════════════
// THIRD CALL — did the follow-up after the demo happen? (Aidan, 2026-11-24)
// ═══════════════════════════════════════════════════════════
//
// third-call-touchpoint (backend) reads 3rd calls off Aidan's and Lars's
// calendars and puts "3rd call scheduled — for 2026-11-20 17:00 · …" on the
// deal's Timeline. Once the call's time has passed, that row asks Showed /
// No-show; the answer is its own Meeting row, tied to the call by its slot, so
// a deal with two follow-ups is asked about each. pipeline-level06 counts the
// show rate from these rows (a win after the call counts as showed on its own).

import { esc, jsArg } from './utils.js?v=20261124113704';
import { sbCreateInteraction, showToast } from './api.js?v=20261124113704';

const SCHEDULED = '3rd call scheduled — for ';
const OUTCOME = '3rd call — ';
const OUTCOMES = ['Showed', 'No-show'];

const slotOf = (content) => (/for (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(String(content || '')) || [])[1] || null;

/** The slot to ask about, when this row is a 3rd call that has passed with no answer; else null. */
export function thirdCallSlotToMark(ev, allEvents) {
  const c = String(ev.content || '');
  if (!c.startsWith(SCHEDULED)) return null;
  const slot = slotOf(c);
  if (!slot || new Date(slot.replace(' ', 'T') + 'Z') > new Date()) return null;
  const answered = allEvents.some(x => String(x.content || '').startsWith(OUTCOME) && slotOf(x.content) === slot);
  return answered ? null : slot;
}

/** The picker under the row; onPick(dealId, slot, outcome) is the timeline's own save-and-refresh. */
export function thirdCallOutcomeSelect(dealId, slot, onPick) {
  return `<div style="margin-top:6px;display:flex;align-items:center;gap:6px">
    <span style="font-size:11px;color:#6b7280">Did the 3rd call happen?</span>
    <select onchange="${onPick}(${jsArg(dealId)},${jsArg(slot)},this.value);this.disabled=true"
      style="padding:4px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:11px;background:#fff;cursor:pointer">
      <option value="">Pick one</option>
      ${OUTCOMES.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
    </select>
  </div>`;
}

export async function markThirdCall(dealId, slot, outcome) {
  if (!OUTCOMES.includes(outcome) || !slot) return false;
  try {
    await sbCreateInteraction({ deal_id: dealId, type: 'Meeting', content: `${OUTCOME}${outcome} · for ${slot} · marked in the CRM` });
    showToast('Marked: ' + outcome, 'success');
    return true;
  } catch (e) {
    showToast('Could not save: ' + e.message, 'error');
    return false;
  }
}
