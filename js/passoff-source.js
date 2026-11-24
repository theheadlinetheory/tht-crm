// ═══════════════════════════════════════════════════════════
// PASSOFF SOURCE — client email leads: draft from the booking call or the SmartLead thread
// ═══════════════════════════════════════════════════════════
//
// Brief 7 Part B (Tim, 2026-11-19). A client email lead booked on a phone call is drafted from the call's
// transcript; one booked purely over email is drafted from the SmartLead thread. The card's Timeline decides
// (a call of 30s or more = booked on the call, backend _shared/booking-call.ts) and the booker can flip it here.
// Before drafting from a call, booking-call-transcript transcribes its recording (Whisper) into the card;
// it is a separate request because transcription and Claude do not both fit in one.

import { invokeEdgeFunction } from './api.js?v=20261124111900';
import { esc, jsArg, str } from './utils.js?v=20261124111900';

/** True for the leads this applies to: client pipeline, not a cold call. */
export const isClientEmailLead = (deal) => !!deal && deal.pipeline === 'Client' && str(deal.leadSource) !== 'cold_call';

const overrides = new Map(); // deal id -> 'call' | 'email', the booker's switch (this session)
const lastDraft = new Map(); // deal id -> { source, label, overridden, transcriptMissing, transcriptError }

export const sourceOverride = (dealId) => overrides.get(String(dealId));

/**
 * Make sure the booking call's transcript is on the card before drafting from it. Never throws: a failed
 * transcription still drafts (from the card) and the card says the transcript is missing.
 * Returns the transcript when there is one, so the caller can put it on the open card.
 */
export async function prepareBookingCall(dealId) {
  const override = sourceOverride(dealId);
  if (override === 'email') return null;
  try {
    const r = await invokeEdgeFunction('booking-call-transcript', override ? { dealId, source: override } : { dealId });
    const err = r && r.via === 'call' && r.error ? r.error : '';
    lastDraft.set(String(dealId), { ...(lastDraft.get(String(dealId)) || {}), transcriptError: err });
    return r && r.transcript ? r.transcript : null;
  } catch (e) {
    console.warn('[passoff-source] transcription failed', dealId, e);
    lastDraft.set(String(dealId), { ...(lastDraft.get(String(dealId)) || {}), transcriptError: String(e && e.message || e) });
    return null;
  }
}

/** The generate-passoff body field for the switch (nothing when the Timeline decides). */
export const sourceBody = (dealId) => (sourceOverride(dealId) ? { source: sourceOverride(dealId) } : {});

/** Remember where the draft came from, from generate-passoff's answer. */
export function rememberSource(dealId, resp) {
  if (!resp || !resp.source) return;
  const prev = lastDraft.get(String(dealId)) || {};
  lastDraft.set(String(dealId), { source: resp.source, label: resp.sourceLabel || '', overridden: !!resp.sourceOverridden,
    transcriptMissing: !!resp.transcriptMissing, transcriptError: prev.transcriptError || '' });
}

/** The line under the draft: what it was drafted from, and the switch. */
export function renderPassoffSource(deal, clientName) {
  if (!isClientEmailLead(deal)) return '';
  const d = lastDraft.get(String(deal.id));
  if (!d || !d.source) {
    return `<div style="font-size:10px;color:var(--text-muted);margin:0 0 8px 0">Claude drafts from the call if this card has a call of 30s or more on its Timeline (the recording is transcribed first), otherwise from the SmartLead email thread.</div>`;
  }
  const other = d.source === 'call' ? 'email' : 'call';
  const otherLabel = other === 'call' ? 'Draft from the call instead' : 'Draft from the email thread instead';
  let h = `<div style="font-size:11px;color:#6b7280;margin:0 0 8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <span>Drafted from <b>${esc(d.label || (d.source === 'call' ? 'the call' : 'the email thread'))}</b>${d.overridden ? ' (your choice)' : ''}.</span>
    <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="switchPassoffSource(${jsArg(deal.id)},${jsArg(other)},${jsArg(clientName)})">${otherLabel}</button>
  </div>`;
  if (d.source === 'call' && d.transcriptMissing) {
    h += `<div style="margin:0 0 8px 0;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e">
      ⚠️ No transcript of the call${d.transcriptError ? ' (' + esc(d.transcriptError) + ')' : ''}, so this draft was written from the card only. Check it against what was said before sending.</div>`;
  }
  return h;
}

/** The switch: remember the choice and redraft (regeneratePassoff asks before overwriting edits). */
function switchPassoffSource(dealId, source, clientName) {
  overrides.set(String(dealId), source);
  window.regeneratePassoffClick(dealId, clientName);
}

window.switchPassoffSource = switchPassoffSource;
