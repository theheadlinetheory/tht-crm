// ═══════════════════════════════════════════════════════════
// CALL TOUCHPOINTS — every JustCall call becomes a deal timeline entry
// ═══════════════════════════════════════════════════════════
//
// Calls reach the timeline through the `justcall-crm-touchpoint` edge function,
// which JustCall posts to on call.completed and again on call.updated — the
// second being when the rep sets the disposition, which is always after hangup.
// That is why the browser cannot own this: the disposition does not exist yet
// when the call ends, and reading it back needs the JustCall API key, which
// cannot live in a public repo.
//
// So nothing here writes a call touchpoint any more. What is left is the
// rendering vocabulary and the manual correction path for calls the webhook
// could not classify.
//
// The `interactions` table is (id, deal_id, type, content, created_at) and
// nothing else, so everything about the call has to live in `content`. The
// shape below is duplicated in the edge function and in
// justcall/crm_touchpoint_sync.py — keep all three in step:
//
//   Outbound call — Answered · 4m 12s · from (904) 642-5303 · Ioannis
//   Outbound call — Disco Conducted: Demo Scheduled · 12m 03s · Ioannis
//
// Keep CALL_PREFIX and the " · " separator stable. applyDisposition() matches
// on them.

import { sbCreateInteraction, sbUpdateInteraction, sbGetInteractions } from './api.js?v=20260904120124';

export const CALL_PREFIX_OUT = 'Outbound call';
export const CALL_PREFIX_IN  = 'Inbound call';
const SEP = ' · ';

// ─── The disposition vocabulary, as configured in JustCall ───
//
// Verified against the live account 2026-08-26: JustCall stores and returns the
// compound string "<Group>: <Value>", so that is what gets written here
// verbatim. The group is the part that matters for reporting — it records
// whether a discovery call actually happened, which is the single number the
// sales-pipeline analysis could not measure without listening to 364 recordings.
export const JUSTCALL_DISPOSITIONS = {
  'Disco Conducted': [
    'Demo Scheduled',        // discovery ran and ended with a demo booked
    'DQ - Out of ICP',       // discovery ran and WE disqualified them
    'Not Now',               // discovery ran, no no, no demo — follow-up pending
    'Not Interested',        // discovery ran and THEY declined
  ],
  'Disco NOT Conducted': [
    'Disco Scheduled',       // reached them, discovery booked for later
    'Busy - Call Back',      // right person, wrong moment
    'No Answer',             // never reached a person
    'Wrong Person/Gatekeeper', // never reached the decision maker
    'DQ - Out of ICP',       // disqualified without running discovery
    'Not Interested',        // declined before any discovery
  ],
  'Acquisition Warm Call Outcomes': [
    'Busy - Call Back',
    'Not Interested',
    'Wrong Person/Gatekeeper',
  ],
};

// ─── Formatting ───

export function fmtCallDuration(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

// US/CA numbers get the familiar shape; everything else keeps its country code
// with a leading + so an AU or UK line does not read as a bare blob.
function fmtUsPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (ten.length === 10 && d.length <= 11) return '(' + ten.slice(0, 3) + ') ' + ten.slice(3, 6) + '-' + ten.slice(6);
  return d ? '+' + d : String(p || '');
}

// The seat that placed the call. contact@ is the shared setter seat, so the
// raw mailbox name would put "contact" on nearly every entry.
const AGENTS = {
  contact: 'Ioannis',
  aidan: 'Aidan',
  lars: 'Lars',
};

export function agentName(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  return AGENTS[local] || local;
}

// Return an outcome ONLY where one is actually known.
//
// Verified against all 2,501 JustCall records on 2026-08-26: `status` is 0 on
// every one of them, and the reps' own dispositions rule out the obvious
// fallback — calls of 2s, 5s and 8s were classified "No Answer" by the person
// who made them, so a non-zero duration does not mean the call connected. That
// is the same trap as level 02's ≥120s convention, which was 19% accurate.
//
// So an empty or unknown outcome produces no claim at all. The disposition the
// rep picks is what fills it in, and a blank beats a wrong one.
function outcomeLabel(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'answered') return 'Answered';
  if (o === 'missed' || o === 'no-answer') return 'No answer';
  if (o === 'voicemail') return 'Voicemail';
  if (o === 'abandoned') return 'Abandoned';
  return '';
}

/**
 * Build the content string for a call touchpoint.
 * Every part after the outcome is optional — a call that JustCall has not
 * logged yet still produces a usable line.
 */
export function buildCallContent({ outcome, duration, fromNumber, region, agent, recordingUrl, inbound }) {
  const parts = [];
  const label = outcomeLabel(outcome);
  parts.push((inbound ? CALL_PREFIX_IN : CALL_PREFIX_OUT) + (label ? ' — ' + label : ''));
  if (duration > 0) parts.push(fmtCallDuration(duration));
  if (fromNumber) parts.push('from ' + fmtUsPhone(fromNumber) + (region ? ' (' + region + ')' : ''));
  if (agent) parts.push(agent);
  let s = parts.join(SEP);
  if (recordingUrl) s += '\n' + recordingUrl;
  return s;
}

/**
 * Write the call to the deal's timeline. Returns the created row, or null if
 * the write failed — a failed touchpoint must never break the call flow, so
 * every caller treats null as "carry on".
 */
export async function logCallTouchpoint(dealId, info) {
  if (!dealId) return null;
  try {
    const row = await sbCreateInteraction({
      deal_id: dealId,
      type: 'Call',
      content: buildCallContent(info || {}),
    });
    return row || null;
  } catch (e) {
    console.warn('[call-touchpoints] failed to log call:', e);
    return null;
  }
}

/**
 * Replace the outcome on an existing call touchpoint with the disposition the
 * rep chose. The disposition is strictly better information than JustCall's
 * answered/missed — a human classified it — so it takes the outcome's place
 * rather than being appended.
 *
 * Falls back to writing a fresh touchpoint if the original has gone.
 */
export async function applyDisposition(dealId, interactionId, disposition) {
  if (!dealId || !disposition) return null;
  try {
    const rows = await sbGetInteractions(dealId);
    const row = (rows || []).find(r => r.id === interactionId)
      || (rows || []).find(r => r.type === 'Call' && String(r.content || '').startsWith(CALL_PREFIX_OUT));
    if (!row) {
      return await sbCreateInteraction({ deal_id: dealId, type: 'Call', content: CALL_PREFIX_OUT + ' — ' + disposition });
    }
    const [head, ...rest] = String(row.content).split(SEP);
    const prefix = head.startsWith(CALL_PREFIX_IN) ? CALL_PREFIX_IN : CALL_PREFIX_OUT;
    const content = [prefix + ' — ' + disposition, ...rest].join(SEP);
    await sbUpdateInteraction(row.id, { content });
    return { ...row, content };
  } catch (e) {
    console.warn('[call-touchpoints] failed to apply disposition:', e);
    return null;
  }
}

/** True if this timeline entry was written by the call logger. */
export function isCallTouchpoint(content) {
  const s = String(content || '');
  return s.startsWith(CALL_PREFIX_OUT) || s.startsWith(CALL_PREFIX_IN);
}
