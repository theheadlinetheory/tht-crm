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
//   after a discovery call      level 03 owns this, through the outcome dropdown
//   after a demo                on the meeting touchpoint (levels 03 and 05).
//
// ONE source of truth for a lost meeting (Lars, 2026-09-04): the touchpoint
// dropdown. If the rep already answered it, archiving asks NOTHING and records
// that answer. If not, archiving shows the dropdown's own list — the same
// DISCO_OUTCOMES / DEMO_OUTCOMES the timeline and the outcome queue use — and
// writes the same mark through the same function. Nothing is ever asked twice
// and no second vocabulary exists.
//
// The archive button, the drag-to-delete zone and bulk archive all route
// acquisition deals here (deal-modal.js, deals.js). Everything is read from the
// deal's Timeline at click time — nothing new is stored.

import { state } from './app.js?v=20260904172901';
import { esc } from './utils.js?v=20260904172901';
import { sbCreateInteraction, sbGetInteractions } from './api.js?v=20260904172901';
import { markDisco, markDemo, OUTCOME_PREFIX, DEMO_OUTCOME_PREFIX, HELD, DISCO_OUTCOMES, DEMO_OUTCOMES } from './disco-outcome.js?v=20260904172901';

export const REMOVAL_PREFIX = 'Removed — ';

// Pre-disco reasons. label = the archive status · note = what follows the prefix
// on the Timeline (pipeline-leads reads it) · hint = examples under the label.
export const ACQ_REMOVAL_REASONS = [
  { label: 'Desk DQ',        note: 'Desk DQ',        tone: 'dq',   hint: 'remote / small town · out of ICP · too small · no website' },
  { label: 'Miscategorized', note: 'Miscategorized', tone: 'dq',   hint: 'the AI tagged a non-positive reply as positive — fix it in Smartlead too' },
  { label: 'Duplicate',      note: 'Duplicate',      tone: 'dq',   hint: 'this company is already on the board' },
  { label: 'Lost',           note: 'Lost',           tone: 'lost', hint: 'not interested, or no response after we worked it' },
];

// Stages a deal cannot reach without a demo having been booked.
const DEMO_STAGES = new Set(['Demo Scheduled', 'Under Review', 'No Show', 'Waiting for Payment/Contract', 'Closed Won']);
const HELD_MARKS = new Set(['demo booked', 'not interested', 'disqualified', 'not right now']);

// What the archive status becomes for each answer.
const DISCO_STATUS = (o) => 'Discovery — ' + o;
const DEMO_STATUS = (o) => /Closed Won|^Won$/.test(o) ? 'Closed Won' : 'Demo — ' + o;
// Which answers WE gave (leave the level) vs THEY gave — only for the colour.
const DQ_ANSWERS = new Set(['Disqualified', 'Not qualified', 'Not Qualified']);
const KEEP_ANSWERS = new Set(['Not right now', 'Demo booked', 'Won', 'Qualified — Not Right Now', 'Qualified — Pending', 'Qualified — Closed Won']);
const NURTURE_ANSWERS = new Set(['Not right now', 'Qualified — Not Right Now']);

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

/** Where the lead is, read off its Timeline, and any outcome already recorded:
 *  { stage: 'demo' | 'disco' | 'disco_pending' | 'pre', when, discoMark, demoMark }.
 *  Mirrors the classification in pipeline-leads. */
export async function leadStage(dealId) {
  const deal = state.deals.find(d => String(d.id) === String(dealId));
  let rows = [];
  try { rows = (await sbGetInteractions(dealId)) || []; } catch (e) { console.warn('[removal-reason] timeline unavailable', e && e.message); }
  const head = (r) => String(r.content || '').split('\n')[0];
  const now = new Date().toISOString();
  let demo = !!(deal && DEMO_STAGES.has(deal.stage));
  let disco = false, discoMark = null, demoMark = null;
  const bookings = new Map(); // meeting time → cancelled?
  let pendingFor = null;
  // rows arrive newest first; the first mark seen is the latest answer.
  for (const r of rows) {
    const h = head(r);
    if (r.type === 'Call' && h.includes('Disco Conducted:')) disco = true;
    if (r.type !== 'Meeting') continue;
    if (h.startsWith(DEMO_OUTCOME_PREFIX)) {
      demo = true;
      if (!demoMark) demoMark = h.slice(DEMO_OUTCOME_PREFIX.length).split(' · ')[0].trim();
    } else if (h.startsWith('Demo scheduled')) demo = true;
    else if (h.startsWith('Discovery call scheduled — for ')) {
      const when = h.slice('Discovery call scheduled — for '.length, 'Discovery call scheduled — for '.length + 16);
      if (!bookings.has(when)) bookings.set(when, false);
    } else if (h.startsWith('Discovery call cancelled — was for ')) {
      bookings.set(h.slice('Discovery call cancelled — was for '.length, 'Discovery call cancelled — was for '.length + 16), true);
    } else if (h.startsWith(OUTCOME_PREFIX) || h.startsWith(HELD)) {
      const v = h.startsWith(HELD) ? 'held' : h.slice(OUTCOME_PREFIX.length).split(' · ')[0].trim();
      if (!discoMark) discoMark = v;
      if (HELD_MARKS.has(v.toLowerCase()) || v === 'held') disco = true;
    }
  }
  for (const [when, cancelled] of bookings) {
    if (!cancelled && when.replace(' ', 'T') + ':00Z' < now) pendingFor = pendingFor || when;
  }
  const stage = demo ? 'demo' : disco ? 'disco' : pendingFor ? 'disco_pending' : 'pre';
  return { stage, when: pendingFor, discoMark, demoMark };
}

/** The archive status a recorded answer maps to, or null when nothing is recorded. */
function recordedStatus(info) {
  // Any final demo answer counts as recorded (older words included); a
  // "Qualified — Pending" mark is not final, so the rep is asked.
  if (info.stage === 'demo' && info.demoMark && !/Pending/i.test(info.demoMark)) return DEMO_STATUS(info.demoMark.split(': ')[0]);
  if ((info.stage === 'disco' || info.stage === 'disco_pending') && info.discoMark) {
    if (info.discoMark === 'held') return DISCO_STATUS('held');
    if (DISCO_OUTCOMES.includes(info.discoMark)) return DISCO_STATUS(info.discoMark);
  }
  return null;
}

/**
 * The picker, for one or many acquisition deals.
 *   onPick(label)  runs after the reason is recorded — the caller archives.
 *   onNurture()    "Move to Nurture" instead of archiving (pre-disco only).
 */
export async function showAcquisitionRemovalPicker(dealIds, { onPick, onNurture }) {
  const existing = document.getElementById('archive-reason-picker');
  if (existing) existing.remove();

  const infos = await Promise.all(dealIds.map(id => leadStage(id)));

  // Already answered on the touchpoint: record that, ask nothing.
  if (dealIds.length === 1) {
    const done = recordedStatus(infos[0]);
    if (done) { onPick(done); return; }
  } else {
    // Bulk: leads whose outcome is already recorded go through with it; leads
    // that never had a call share one answer; anything else must be done alone.
    const unanswered = dealIds.filter((_, i) => infos[i].stage !== 'pre' && !recordedStatus(infos[i]));
    if (unanswered.length) {
      alert(unanswered.length + ' of these leads had a discovery call or a demo with no outcome recorded yet. Archive those one at a time (or answer the dropdown on the timeline first); the rest can be bulk-archived.');
      return;
    }
    const answered = dealIds.filter((_, i) => infos[i].stage !== 'pre');
    if (answered.length === dealIds.length) { onPick('Outcome on timeline'); return; }
    // Mixed: fall through with the pre-disco list for the rest; the answered
    // ones archive under the same status label (their mark is on the timeline).
  }
  const { stage, when } = infos[0];
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
    let ok = true;
    try { ok = (await work()) !== false; } catch (e) { console.warn('[removal-reason]', e && e.message); }
    if (ok && label !== null) onPick(label);
  };
  const toneFor = (o) => DQ_ANSWERS.has(o) ? 'dq' : KEEP_ANSWERS.has(o) ? 'keep' : 'lost';

  if (stage === 'demo') {
    heading('This lead had a demo. How did it end?', 'The same answers as the demo dropdown on the Timeline — recorded once, there.');
    // Exactly DEMO_OUTCOMES. markDemo writes the mark; "Not right now" opens the
    // Move to Nurture modal itself, so no archive follows it.
    DEMO_OUTCOMES.forEach(o => button(o, toneFor(o), () => finish(NURTURE_ANSWERS.has(o) ? null : DEMO_STATUS(o), () => markDemo(dealId, o))));
  } else if (stage === 'disco' || stage === 'disco_pending') {
    heading(stage === 'disco' ? 'This lead had a discovery call. How did it end?' : `A discovery call was booked for ${when}. What happened?`,
            'The same answers as the outcome dropdown on the Timeline — recorded once, there.');
    // Exactly DISCO_OUTCOMES, same rule for "Not right now".
    DISCO_OUTCOMES.forEach(o => button(o, toneFor(o), () => finish(NURTURE_ANSWERS.has(o) ? null : DISCO_STATUS(o), () => markDisco(dealId, o))));
  } else {
    const n = dealIds.length;
    heading(`Why is ${n === 1 ? 'this lead' : n + ' leads'} being removed?`, 'Feeds level 02 of the sales pipeline. Desk DQ / Miscategorized / Duplicate = we removed them. Lost = they dropped.');
    const preIds = dealIds.filter((_, i) => infos[i].stage === 'pre');
    ACQ_REMOVAL_REASONS.forEach(r => button(r.label, r.tone, () => finish(r.label, () => Promise.all(preIds.map(id => writeRemovalNote(id, r.note)))), r.hint));
    if (onNurture) button('Move to Nurture', 'keep', () => { div.remove(); onNurture(); });
    button('Other…', 'other', () => {
      const r = prompt('Reason:');
      if (r && r.trim()) finish(r.trim(), () => Promise.all(preIds.map(id => writeRemovalNote(id, 'Other: ' + r.trim()))));
    });
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
