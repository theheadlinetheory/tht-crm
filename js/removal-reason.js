// ═══════════════════════════════════════════════════════════
// REMOVAL REASON — why an acquisition lead left the board
// ═══════════════════════════════════════════════════════════
//
// Level 02 of the sales pipeline (positive response → discovery conducted)
// needs to know WHY a positive was removed before a disco happened. Two of the
// reasons are US removing THEM — a desk disqualification, a reply the AI
// mis-tagged as positive — and those leave the level's denominator. Every other
// reason is a loss and stays in it (counting-rules.md).
//
// Until 2026-09-03 every removal landed as the generic "Deleted/Lost" — 283 of
// 283 in the previous 30 days — with the real reason sometimes typed into the
// notes ("remote town DQ"). The two kinds could not be told apart, which is why
// level 02's denominator was the largest unknown in the whole funnel.
//
// So the reason is captured where the click already happens. The archive button,
// the drag-to-delete zone and bulk archive all route acquisition deals through
// this picker. One click. The answer is stored twice: as the archive status, and
// as a Note on the deal Timeline —
//
//   Removed — Desk DQ: remote / small town · marked in the CRM
//
// which is what pipeline-level02 reads. A field nobody is forced through stays
// null; this one cannot be skipped.

import { esc } from './utils.js?v=20260903134214';
import { sbCreateInteraction } from './api.js?v=20260903134214';

export const REMOVAL_PREFIX = 'Removed — ';

// label = what the rep sees, and what the archive status becomes.
// note  = what follows the prefix on the Timeline (the level reads this).
// tone  = dq: we removed them (leaves the denominator) · lost: they dropped
// hint  = shown under the label; the examples of what qualifies.
export const ACQ_REMOVAL_REASONS = [
  { label: 'Desk DQ',        note: 'Desk DQ',        tone: 'dq',   hint: 'remote / small town · out of ICP · too small · no website' },
  { label: 'Miscategorized', note: 'Miscategorized', tone: 'dq',   hint: 'the AI tagged a non-positive reply as positive — fix it in Smartlead too' },
  { label: 'Duplicate',      note: 'Duplicate',      tone: 'dq',   hint: 'this company is already on the board' },
  { label: 'Not interested / no response', note: 'Not interested / no response', tone: 'lost' },
  { label: 'Closed Lost',    note: 'Closed Lost',    tone: 'lost' },
];

const TONE = {
  dq:    'background:#fef9c3;color:#a16207;border:1px solid #fde68a',
  lost:  'background:#fef2f2;color:#dc2626;border:1px solid #fecaca',
  keep:  'background:#f0fdf4;color:#059669;border:1px solid #a7f3d0',
  other: 'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe',
};

/** The Timeline note. Written BEFORE the deal is archived so the reason and the
 *  removal can never be separated. Failure is logged, never fatal — losing a
 *  note must not block the rep from archiving. */
export async function writeRemovalNote(dealId, note) {
  try {
    await sbCreateInteraction({ deal_id: dealId, type: 'Note', content: REMOVAL_PREFIX + note + ' · marked in the CRM' });
  } catch (e) {
    console.warn('[removal-reason] note not saved for', dealId, e && e.message);
  }
}

/**
 * The picker, for one or many acquisition deals.
 *   onPick(label)  runs after the note is on every deal — the caller archives.
 *   onNurture()    "Move to Nurture" instead of archiving (optional).
 */
export function showAcquisitionRemovalPicker(dealIds, { onPick, onNurture }) {
  const existing = document.getElementById('archive-reason-picker');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'archive-reason-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) div.remove(); };

  const n = dealIds.length;
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:360px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">Why is ${n === 1 ? 'this lead' : n + ' leads'} being removed?</h3>
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">Feeds the sales pipeline. Desk DQ / miscategorized / duplicate = we removed them. The rest = they dropped.</div>`;
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const button = (text, tone, handler, hint) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = 'width:100%;justify-content:start;padding:10px 14px;flex-direction:column;align-items:flex-start;gap:2px;' + TONE[tone];
    const main = document.createElement('span');
    main.textContent = text;
    b.appendChild(main);
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'font-size:10px;font-weight:400;opacity:.8;text-align:left';
      h.textContent = hint;
      b.appendChild(h);
    }
    b.onclick = handler;
    list.appendChild(b);
  };
  const pick = async (label, note) => {
    div.remove();
    await Promise.all(dealIds.map((id) => writeRemovalNote(id, note)));
    onPick(label);
  };

  ACQ_REMOVAL_REASONS.forEach((r) => button(r.label, r.tone, () => pick(r.label, r.note), r.hint));
  if (onNurture) button('Move to Nurture', 'keep', () => { div.remove(); onNurture(); });
  button('Other…', 'other', () => {
    const r = prompt('Reason:');
    if (r && r.trim()) pick(r.trim(), 'Other: ' + r.trim());
  });

  box.appendChild(list);
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.style.cssText = 'width:100%;margin-top:12px;font-size:12px';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => div.remove();
  box.appendChild(cancel);
  div.appendChild(box);
  document.body.appendChild(div);
}
