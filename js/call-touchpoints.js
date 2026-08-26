// ═══════════════════════════════════════════════════════════
// CALL TOUCHPOINTS — every JustCall call becomes a deal timeline entry
// ═══════════════════════════════════════════════════════════
//
// Before this, a call from the deal card wrote an *activity* only, so the deal
// card's Timeline still read "No touchpoints logged yet" no matter how many
// times someone had dialled. Calls now write an `interactions` row too — that
// is the table the Timeline reads.
//
// The `interactions` table is (id, deal_id, type, content, created_at) and
// nothing else, so everything about the call has to live in `content`. It is
// written in a fixed, parseable shape so a later pass can find a call
// touchpoint again and fill in the disposition:
//
//   Outbound call — Answered · 4m 12s · from (904) 642-5303 · Ioannis
//   Outbound call — Disco Conducted: Demo Scheduled · 12m 03s · Ioannis
//
// Keep CALL_PREFIX and the " · " separator stable. applyDisposition() matches
// on them.

import { sbCreateInteraction, sbUpdateInteraction, sbGetInteractions } from './api.js?v=20260826140103';

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

function fmtUsPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 ? '(' + ten.slice(0, 3) + ') ' + ten.slice(3, 6) + '-' + ten.slice(6) : String(p || '');
}

// JustCall reports a call `type` of answered / missed / voicemail / unknown.
// "unknown" means the call log had not caught up yet — say so rather than
// inventing an outcome, because a wrong outcome is worse than an absent one.
function outcomeLabel(outcome, duration) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'answered') return 'Answered';
  if (o === 'missed' || o === 'no-answer') return 'No answer';
  if (o === 'voicemail') return 'Voicemail';
  if (o === 'abandoned') return 'Abandoned';
  if (!o || o === 'unknown') return duration > 0 ? 'Connected' : 'Outcome not reported';
  return o.charAt(0).toUpperCase() + o.slice(1);
}

/**
 * Build the content string for a call touchpoint.
 * Every part after the outcome is optional — a call that JustCall has not
 * logged yet still produces a usable line.
 */
export function buildCallContent({ outcome, duration, fromNumber, region, agent, recordingUrl, inbound }) {
  const parts = [];
  parts.push((inbound ? CALL_PREFIX_IN : CALL_PREFIX_OUT) + ' — ' + outcomeLabel(outcome, duration));
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
