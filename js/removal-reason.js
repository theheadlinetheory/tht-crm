// ═══════════════════════════════════════════════════════════
// REMOVAL REASON — why an acquisition lead left the board
// ═══════════════════════════════════════════════════════════
//
// The sales pipeline needs to know WHY a positive reply leaves the board, and
// the answer belongs in a different place depending on how far the lead got:
//
//   before any discovery call   level 02's denominator. Desk DQ, Miscategorized
//                               and Duplicate mean WE removed them and they leave
//                               the level; Lost means THEY dropped and stays in.
//                               Written as a Timeline Note: "Removed — Desk DQ".
//   after a discovery call      level 03 owns this. The picker asks level 03's
//                               own question (Not interested / Disqualified, plus
//                               No-show for a booked disco with no outcome yet)
//                               and writes the same "Discovery call — …" mark
//                               the outcome dropdown writes.
//   after a demo                level 05 owns this: Lost / Not qualified, the
//                               same "Demo — …" mark as the demo dropdown, or
//                               Not Right Now, which moves the deal to Nurture
//                               the way the Demo Tracker does.
//
// One picker, one click, and every fact is recorded exactly once, in the place
// the level that needs it reads. Before 2026-09-03 every removal landed as the
// generic "Deleted/Lost" — 283 of 283 in the previous 30 days — and a rep who
// archived after a disco was still asked about it in the outcome queue.
//
// The archive button, the drag-to-delete zone and bulk archive all route
// acquisition deals here (deal-modal.js, deals.js). The stage is read from the
// deal's Timeline at click time — nothing new is stored.

import { state } from './app.js?v=20260903144704';
import { esc } from './utils.js?v=20260903144704';
import { sbCreateInteraction, sbGetInteractions } from './api.js?v=20260903144704';
import { markDisco, markDemo, OUTCOME_PREFIX, DEMO_OUTCOME_PREFIX, HELD } from './disco-outcome.js?v=20260903144704';

export const REMOVAL_PREFIX = 'Removed — ';

// Pre-disco reasons. label = the archive status · note = what follows the prefix
// on the Timeline (pipeline-level02 reads it) · hint = examples under the label.
export const ACQ_REMOVAL_REASONS = [
  { label: 'Desk DQ',        note: 'Desk DQ',        tone: 'dq',   hint: 'remote / small town · out of ICP · too small · no website' },
  { label: 'Miscategorized', note: 'Miscategorized', tone: 'dq',   hint: 'the AI tagged a non-positive reply as positive — fix it in Smartlead too' },
  { label: 'Duplicate',      note: 'Duplicate',      tone: 'dq',   hint: 'this company is already on the board' },
  { label: 'Lost',           note: 'Lost',           tone: 'lost', hint: 'not interested, or no response after we worked it' },
];

// Stages a deal cannot reach without a demo having been booked.
const DEMO_STAGES = new Set(['Demo Scheduled', 'Under Review', 'No Show', 'Waiting for Payment/Contract', 'Closed Won']);
const HELD_MARKS = new Set(['demo booked', 'not interested', 'disqualified']);

const TONE = {
  dq:    'background:#fef9c3;color:#a16207;border:1px solid #fde68a',
  lost:  'background:#fef2f2;color:#dc2626;border:1px solid #fecaca',
  keep:  'background:#f0fdf4;color:#059669;border:1px solid #a7f3d0',
  other: 'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe',
};

/** The Timeline note for a pre-disco removal. Written BEFORE the deal is archived
 *  so the reason and the removal can never be separated. Failure is logged,
 *  never fatal — losing a note must not block the rep from archiving. */
export async function writeRemovalNote(dealId, note) {
  try {
    await sbCreateInteraction({ deal_id: dealId, type: 'Note', content: REMOVAL_PREFIX + note + ' · marked in the CRM' });
  } catch (e) {
    console.warn('[removal-reason] note not saved for', dealId, e && e.message);
  }
}

/** Where the lead is, read off its Timeline: 'demo' | 'disco' | 'disco_pending' | 'pre'.
 *  Mirrors the classification in pipeline-level02. */
export async function leadStage(dealId) {
  const deal = state.deals.find(d => String(d.id) === String(dealId));
  let rows = [];
  try { rows = (await sbGetInteractions(dealId)) || []; } catch (e) { console.warn('[removal-reason] timeline unavailable', e && e.message); }
  const head = (r) => String(r.content || '').split('\n')[0];
  const now = new Date().toISOString();
  let demo = !!(deal && DEMO_STAGES.has(deal.stage));
  let disco = false;
  const bookings = new Map(); // meeting time → cancelled?
  let pendingFor = null;
  for (const r of rows) {
    const h = head(r);
    if (r.type === 'Call' && h.includes('Disco Conducted:')) disco = true;
    if (r.type !== 'Meeting') continue;
    if (h.startsWith('Demo scheduled') || h.startsWith(DEMO_OUTCOME_PREFIX)) demo = true;
    else if (h.startsWith('Discovery call scheduled — for ')) {
      const when = h.slice('Discovery call scheduled — for '.length, 'Discovery call scheduled — for '.length + 16);
      if (!bookings.has(when)) bookings.set(when, false);
    } else if (h.startsWith('Discovery call cancelled — was for ')) {
      bookings.set(h.slice('Discovery call cancelled — was for '.length, 'Discovery call cancelled — was for '.length + 16), true);
    } else if (h.startsWith(OUTCOME_PREFIX)) {
      const v = h.slice(OUTCOME_PREFIX.length).split(' · ')[0].trim().toLowerCase();
      if (HELD_MARKS.has(v) || h.startsWith(HELD)) disco = true;
    }
  }
  for (const [when, cancelled] of bookings) {
    if (!cancelled && when.replace(' ', 'T') + ':00Z' < now) pendingFor = pendingFor || when;
  }
  if (demo) return { stage: 'demo' };
  if (disco) return { stage: 'disco' };
  if (pendingFor) return { stage: 'disco_pending', when: pendingFor };
  return { stage: 'pre' };
}

/**
 * The picker, for one or many acquisition deals.
 *   onPick(label)  runs after the reason is recorded — the caller archives.
 *   onNurture()    "Move to Nurture" instead of archiving (optional).
 */
export async function showAcquisitionRemovalPicker(dealIds, { onPick, onNurture }) {
  const existing = document.getElementById('archive-reason-picker');
  if (existing) existing.remove();

  // Bulk: only leads that never got a call can share one answer. Anything that
  // had a disco or a demo has to be archived on its own so its outcome lands.
  const stages = await Promise.all(dealIds.map(id => leadStage(id)));
  const advanced = dealIds.filter((_, i) => stages[i].stage !== 'pre');
  if (dealIds.length > 1 && advanced.length) {
    alert(advanced.length + ' of these leads had a discovery call or a demo. Archive those one at a time so the outcome gets recorded; the rest can be bulk-archived.');
    return;
  }
  const { stage, when } = stages[0];
  const dealId = dealIds[0];

  const div = document.createElement('div');
  div.id = 'archive-reason-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:360px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  const heading = (title, sub) => {
    box.innerHTML = `<h3 style="margin:0 0 4px;font-size:16px">${esc(title)}</h3>
      <div style="font-size:11px;color:#6b7280;margin-bottom:14px">${esc(sub)}</div>`;
  };
  const button = (text, tone, handler, hint) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = 'width:100%;justify-content:start;padding:10px 14px;flex-direction:column;align-items:flex-start;gap:2px;' + TONE[tone];
    const main = document.createElement('span'); main.textContent = text; b.appendChild(main);
    if (hint) { const h = document.createElement('span'); h.style.cssText = 'font-size:10px;font-weight:400;opacity:.8;text-align:left'; h.textContent = hint; b.appendChild(h); }
    b.onclick = handler;
    list.appendChild(b);
  };
  const finish = async (label, work) => {
    div.remove();
    try { await work(); } catch (e) { console.warn('[removal-reason]', e && e.message); }
    onPick(label);
  };
  const other = () => button('Other…', 'other', () => {
    const r = prompt('Reason:');
    if (r && r.trim()) finish(r.trim(), () => Promise.all(dealIds.map(id => writeRemovalNote(id, 'Other: ' + r.trim()))));
  });
  const nurture = (fromDemo) => onNurture && button(fromDemo ? 'Not Right Now — move to Nurture' : 'Move to Nurture', 'keep', () => {
    div.remove();
    if (fromDemo) { state._nurtureEntryBucket = 'not_now'; state._nurtureEntryFromDemo = true; }
    onNurture();
  });

  const n = dealIds.length;
  if (stage === 'demo') {
    heading('This lead had a demo. How did it end?', 'Feeds level 05 of the sales pipeline — the same mark as the demo dropdown on the Timeline.');
    button('Lost', 'lost', () => finish('Demo — Lost', () => markDemo(dealId, 'Lost')), 'they said no after the demo');
    button('Not qualified', 'dq', () => finish('Demo — Not qualified', () => markDemo(dealId, 'Not qualified')), 'we ended it on the demo — leaves the level');
    nurture(true);
  } else if (stage === 'disco' || stage === 'disco_pending') {
    heading(stage === 'disco' ? 'This lead had a discovery call. How did it end?' : `A discovery call was booked for ${when}. What happened?`,
            'Feeds level 03 of the sales pipeline — the same mark as the outcome dropdown on the Timeline.');
    if (stage === 'disco_pending') button('No-show', 'lost', () => finish('Discovery — No-show', () => markDisco(dealId, 'No-show')), 'the call never happened');
    button('Not interested', 'lost', () => finish('Discovery — Not interested', () => markDisco(dealId, 'Not interested')), 'the call happened, they said no');
    button('Disqualified', 'dq', () => finish('Discovery — Disqualified', () => markDisco(dealId, 'Disqualified')), 'the call happened, we ended it — leaves the level');
    nurture(false);
    other();
  } else {
    heading(`Why is ${n === 1 ? 'this lead' : n + ' leads'} being removed?`, 'Feeds level 02 of the sales pipeline. Desk DQ / Miscategorized / Duplicate = we removed them. Lost = they dropped.');
    ACQ_REMOVAL_REASONS.forEach(r => button(r.label, r.tone, () => finish(r.label, () => Promise.all(dealIds.map(id => writeRemovalNote(id, r.note)))), r.hint));
    nurture(false);
    other();
  }

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
