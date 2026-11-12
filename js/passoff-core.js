// ═══════════════════════════════════════════════════════════
// PASSOFF CORE — the pass-off panel's decisions, with no imports so node can test them
// ═══════════════════════════════════════════════════════════
// "Draft pass-off with Claude" worked for two leads, then on the third the click did nothing, and
// "Send pass-off to client" did nothing either (Tim, 2026-11-12). Any re-render (a realtime event,
// the 2-minute sync, coming back to the tab) rebuilt the card with the buttons idle while the request
// was still running: the button looked dead and a second click sent a second request.
// What is in flight now lives here, per deal + action, and every render draws the buttons from it.
// See scripts/test-passoff-core.mjs.

export const ACTIONS = ['generate', 'revise', 'send', 'gmail-draft'];

export const BUSY_LABELS = {
  generate: 'Generating…',
  revise: 'Claude is rewriting…',
  send: 'Sending…',
  'gmail-draft': 'Saving draft…',
};

// `host` is the object carrying the shared busy counter (window in the browser, C3 in the sprint
// contracts): other code holds back full re-renders and the version auto-reload while it is > 0.
export function createInFlight(host) {
  const running = new Map(); // "dealId|action" -> true
  const key = (dealId, action) => String(dealId) + '|' + action;
  return {
    has(dealId, action) { return running.has(key(dealId, action)); },
    /** Anything in flight for this deal, or for these actions only. */
    any(dealId, actions = ACTIONS) { return actions.some(a => running.has(key(dealId, a))); },
    /** The one action in flight for this deal (first found), or null. */
    current(dealId) { return ACTIONS.find(a => running.has(key(dealId, a))) || null; },
    /** false when this deal already has something in flight: the click is ignored. */
    begin(dealId, action) {
      if (this.any(dealId)) return false;
      running.set(key(dealId, action), true);
      if (host) host.__crmBusy = (host.__crmBusy || 0) + 1;
      return true;
    },
    end(dealId, action) {
      if (!running.delete(key(dealId, action))) return;
      if (host) host.__crmBusy = Math.max(0, (host.__crmBusy || 0) - 1);
    },
  };
}

// The one map the CRM uses (passoff.js + cold-call-email.js). Tests build their own with createInFlight.
export const passoffInFlight = createInFlight(typeof window !== 'undefined' ? window : null);

/** How a pass-off button draws: every button on the deal is disabled while anything runs (sending
 *  mid-rewrite would send the old text), and the one that is running says what it is doing. */
export function buttonState(inFlight, dealId, action, idleLabel) {
  const running = inFlight.current(dealId);
  if (!running) return { disabled: false, label: idleLabel };
  return { disabled: true, label: running === action ? BUSY_LABELS[action] : idleLabel };
}

/** The pass-off boxes are locked while Claude writes into them, so nothing typed there is lost
 *  (or put back over Claude's text by the keep-what-they're-typing guard on re-render). */
export function textLocked(inFlight, dealId) {
  return inFlight.any(dealId, ['generate', 'revise']);
}

const s = v => (v === null || v === undefined) ? '' : String(v);

/** What is on screen wins: the box, then the first copy of the deal that has text. */
export function onScreenText(boxValue, ...copies) {
  if (s(boxValue).trim()) return s(boxValue);
  for (const c of copies) if (s(c).trim()) return s(c);
  return '';
}

/** generate-passoff revise body (C1): revise what is on screen now, not the last saved copy. */
export function reviseBody(dealId, clientName, instruction, history, clientBox, leadBox) {
  const body = { dealId, clientName, mode: 'revise', instruction, history };
  if (clientBox !== null && clientBox !== undefined) {
    body.drafts = { client_message: s(clientBox), lead_message: s(leadBox) };
  }
  return body;
}

/** A 200 with no draft is a failure (C1), not a success that wipes the box. */
export function checkDraft(resp) {
  if (!resp) throw new Error('No response from server');
  if (resp.error) throw new Error(resp.error);
  if (!s(resp.instructions).trim()) throw new Error('Claude returned an empty draft — try again');
  return resp;
}

/** Our 90s abort, or the network dropping: the server may still have finished and saved. */
export function mayHaveFinished(e) {
  return !!e && (e.name === 'AbortError' || e.name === 'TypeError');
}

/** After a timeout, the deal row re-read from the database: the drafts the server saved, or null
 *  when nothing new was written (still "timed out"). `before` is the text sent / on screen. */
export function recoveredDrafts(row, before) {
  const text = s(row && row.passoff_instructions);
  if (!text.trim() || text === s(before)) return null;
  return {
    instructions: text,
    leadMessage: s(row.passoff_lead_message),
    callPoints: row.call_points === undefined ? undefined : s(row.call_points),
  };
}

export function isAlreadySent(x) {
  return !!x && (x.message === 'already_sent' || x.error === 'already_sent');
}

/** send_to_client_thread (C2). The server answers 409 already_sent when the pass-off went out
 *  before; we ask, and only then send again with resend:true. Returns null when they say no. */
export async function sendOnce(invoke, body, { confirm, clientName, sentAt }) {
  let resp;
  try {
    resp = await invoke(body);
    if (!isAlreadySent(resp)) return resp;
  } catch (e) {
    if (!isAlreadySent(e)) throw e;
  }
  const when = s((resp && resp.sentAt) || sentAt) || 'an earlier time';
  if (!confirm(`Already sent to ${clientName} at ${when}. Send again?`)) return null;
  return invoke({ ...body, resend: true });
}

/** Calendly's start_time as the date + time on the client's clock (their Calendly is in their zone),
 *  not the caller's browser clock. Falls back to the browser clock without a zone. */
export function zonedDateTime(iso, ianaTz) {
  const dt = new Date(iso);
  if (ianaTz) {
    try {
      const p = {};
      for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
        timeZone: ianaTz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(dt)) p[type] = value;
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    } catch { /* unknown zone: browser clock below */ }
  }
  const pad = n => String(n).padStart(2, '0');
  return {
    date: dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()),
    time: pad(dt.getHours()) + ':' + pad(dt.getMinutes()),
  };
}
