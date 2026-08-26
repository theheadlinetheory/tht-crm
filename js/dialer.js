// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Dialer (embedded iframe via SDK protocol)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260826144756';
import { str, esc, uid, getToday } from './utils.js?v=20260826144756';
import { invokeEdgeFunction, sbCreateActivity, camelToSnake } from './api.js?v=20260826144756';
import { getBestNumberForLead, getRegionForPhone, recordCallOutcome } from './number-health.js?v=20260826144756';
import { JUSTCALL_USER_MAP } from './config.js?v=20260826144756';
import { currentUser } from './auth.js?v=20260826144756';
import { logCallTouchpoint, applyDisposition, agentName, JUSTCALL_DISPOSITIONS } from './call-touchpoints.js?v=20260826144756';

const DIALER_URL = 'https://app.justcall.io/dialer';
let dialerReady = false;
let currentCallDealId = null;
let currentCallNumber = null; // outbound number used
let currentCallPhone = null;  // lead's phone
let justcallNumbers = [];     // numbers available in JustCall account
let lastCall = null;          // { dealId, interactionId } — target for the disposition
let pendingTouchpoint = null; // resolves once the touchpoint row exists

// Persistent iframe — created once, reused for all calls
let persistentIframe = null;

export function initJustCallDialer(){
  // Listen for SDK events from JustCall iframe
  window.addEventListener('message', (e) => {
    if(e.origin !== 'https://app.justcall.io') return;
    const data = e.data;
    if(!data) return;
    console.log('[JustCall msg]', JSON.stringify(data).substring(0, 500));

    // SDK events use data.name for event type
    const evtName = data.name || data.type || '';
    const evtData = data.data || data;

    if(evtName === 'logged-in-status' || evtName === 'login-status' || evtName === 'login') {
      dialerReady = true;
      const nums = evtData.login_numbers || data.login_numbers;
      if(nums && nums.length) {
        justcallNumbers = nums;
        console.log('[JustCall] Available numbers:', JSON.stringify(nums));
      }
    }
    if(evtName === 'call-ended' || evtName === 'hangup' || data.type === 'call-ended') {
      onCallEnded();
    }
    // The rep picks the disposition in JustCall after hanging up. If the SDK
    // announces it we can write it straight onto the touchpoint we just logged
    // and nobody has to pick it twice. Event name unconfirmed — the console
    // line above shows what actually arrives, so widen this when we see it.
    if(evtName === 'disposition' || evtName === 'call-disposition' || evtName === 'disposition-updated') {
      const code = evtData.disposition_code || evtData.disposition || evtData.code;
      if(code && lastCall) applyDisposition(lastCall.dealId, lastCall.interactionId, code);
    }
  });
}

function getOrCreateIframe(){
  if(persistentIframe && document.body.contains(persistentIframe)) return persistentIframe;
  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  let src = DIALER_URL;
  const jcId = currentUser && currentUser.email ? JUSTCALL_USER_MAP[currentUser.email.toLowerCase()] : null;
  if(jcId) src += '?agent_id=' + jcId;
  iframe.src = src;
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  persistentIframe = iframe;
  return iframe;
}

function sendToDialer(msg){
  const iframe = document.getElementById('justcall-dialer-iframe');
  if(iframe && iframe.contentWindow){
    iframe.contentWindow.postMessage(msg, 'https://app.justcall.io');
  }
}

export async function callInJustCall(dealId, phoneField){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal) return;
  const phone = phoneField === 'mobilePhone' ? (str(deal.mobilePhone) || str(deal.phone)) : (str(deal.phone) || str(deal.mobilePhone));
  if(!phone){ alert('No phone number on this deal.'); return; }
  const digits = phone.replace(/\D/g, '');
  const formatted = digits.length === 10 ? '+1' + digits
    : digits.length === 11 && digits[0] === '1' ? '+' + digits
    : '+' + digits;

  // Smart number selection — picks healthiest number closest to lead's area code
  // Falls back to default JustCall number if health data isn't loaded
  const bestNumber = getBestNumberForLead(formatted);
  const outboundNumber = bestNumber ? bestNumber.number : null;

  // Show the widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  const formattedOutbound = outboundNumber ? outboundNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '';

  title.textContent = deal.contact || deal.company || formatted;
  widget.style.display = 'flex';
  widget.style.height = '90vh';
  dialerEl.style.display = '';

  const regionBadge = document.getElementById('justcall-region-badge');
  if(regionBadge) regionBadge.textContent = outboundNumber ? 'From: ' + formattedOutbound + (bestNumber && bestNumber.region ? ' (' + bestNumber.region + ')' : '') : '';

  const dispEl = document.getElementById('justcall-disposition');
  if(dispEl) dispEl.style.display = 'none';

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Build dialer URL with destination + caller ID pre-selected
  let dialerSrc = DIALER_URL + '?numbers=' + encodeURIComponent(formatted);
  if(outboundNumber) dialerSrc += '&caller_id=' + encodeURIComponent(outboundNumber);
  const jcAgentId = currentUser && currentUser.email ? JUSTCALL_USER_MAP[currentUser.email.toLowerCase()] : null;
  if(jcAgentId) dialerSrc += '&agent_id=' + jcAgentId;

  // Check if we can reuse the existing iframe (same agent, no active call)
  const existing = document.getElementById('justcall-dialer-iframe');
  if(existing && existing.contentWindow){
    // Update src to load new call params — keeps same iframe element
    existing.src = dialerSrc;
  } else {
    dialerEl.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.id = 'justcall-dialer-iframe';
    iframe.src = dialerSrc;
    iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    dialerEl.appendChild(iframe);
  }
}

async function onCallEnded(){
  if(!currentCallDealId || !currentCallPhone) return;
  const dealId = currentCallDealId;
  const number = currentCallNumber;
  const phone = currentCallPhone;
  currentCallDealId = null;
  currentCallNumber = null;
  currentCallPhone = null;
  const deal = state.deals.find(d => d.id === dealId);

  // Ask for the outcome FIRST, before anything that waits on the network.
  // Enriching the touchpoint from JustCall's call log takes up to 13 seconds
  // (5s settle plus two retries) and in practice returns nothing, so hanging
  // the prompt off it would put it in front of the rep long after they had
  // moved on. The disposition is the information here; the call log is a
  // nice-to-have.
  lastCall = { dealId, interactionId: null };
  const pending = logCallTouchpoint(dealId, {
    outcome: '', duration: 0, fromNumber: number, region: getRegionForPhone(phone),
    agent: currentUser && currentUser.email ? agentName(currentUser.email) : '',
  }).then(row => { if(lastCall && lastCall.dealId === dealId) lastCall.interactionId = row && row.id; return row; });
  pendingTouchpoint = pending;
  showPostCallDisposition(deal ? (deal.contact || deal.company) : '');

  try {
    await pending;
    const { refreshModal } = await import('./render.js?v=20260826144756');
    if(state.selectedDeal === dealId) refreshModal();
  } catch(e){
    console.warn('[Dialer] Failed to log call touchpoint:', e);
  }

  // Now the slow part: the call log drives number-health scoring and the
  // activity row. Neither is user-facing, so it can take as long as it takes.
  try {
    let call = null;
    for(let attempt = 0; attempt < 3; attempt++){
      if(attempt > 0) await new Promise(r => setTimeout(r, 4000));
      const result = await invokeEdgeFunction('justcall-dialer', { action: 'call-log', phone: phone });
      call = result?.call;
      if(call?.type && call.type !== 'unknown') break;
    }
    const wasAnswered = call?.type === 'answered';
    const duration = call?.duration || 0;
    const outcome = call?.type || 'unknown';

    await recordCallOutcome(number, wasAnswered);

    const region = getRegionForPhone(phone);
    const subject = outcome.charAt(0).toUpperCase() + outcome.slice(1)
      + (duration > 0 ? ' \u2014 ' + duration + 's' : '')
      + ' via ' + region;
    await sbCreateActivity(camelToSnake({
      id: uid(),
      dealId: dealId,
      type: 'Call',
      subject: subject,
      dueDate: getToday(),
      done: true,
      completedAt: new Date().toISOString(),
    }));

    // Start transcript polling for Client pipeline deals after answered calls
    if(wasAnswered && deal && deal.pipeline === 'Client' && phone){
      window.startTranscriptPolling && window.startTranscriptPolling(dealId, phone);
    }
  } catch(e){
    console.warn('[Dialer] Failed to log call outcome:', e);
  }
}

// ─── Post-call disposition ───
//
// The one place the outcome can be captured reliably is the seconds right after
// hangup. Reading it back out of JustCall is not possible from the browser (the
// API key is server-side, and this repo is public), and polling for it on a
// timer means the touchpoint is wrong until the timer fires. So it is asked
// for here and written straight through.

function showPostCallDisposition(who){
  const el = document.getElementById('justcall-disposition');
  if(!el || !lastCall) return;
  let h = '<div style="color:#94a3b8;font-size:11px;font-weight:600;margin-bottom:6px">How did that call go?'
        + (who ? ' \u2014 <span style="color:#e2e8f0">' + esc(who) + '</span>' : '') + '</div>';
  h += '<div style="display:flex;gap:6px">';
  h += '<select id="jc-disp-select" style="flex:1;padding:5px 7px;border:1px solid #334155;border-radius:6px;font-size:11px;background:#1e293b;color:#e2e8f0;min-width:0">';
  h += '<option value="">Skip</option>';
  Object.entries(JUSTCALL_DISPOSITIONS).forEach(([group, values]) => {
    h += '<optgroup label="' + esc(group) + '">';
    values.forEach(v => { h += '<option value="' + esc(group + ': ' + v) + '">' + esc(v) + '</option>'; });
    h += '</optgroup>';
  });
  h += '</select>';
  h += '<button onclick="savePostCallDisposition()" style="padding:5px 12px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">Log it</button>';
  h += '</div>';
  el.innerHTML = h;
  el.style.display = '';
}

async function savePostCallDisposition(){
  const sel = document.getElementById('jc-disp-select');
  const el = document.getElementById('justcall-disposition');
  const value = sel && sel.value;
  const target = lastCall;
  if(el) el.style.display = 'none';
  if(!value || !target) return;
  // The rep can pick before the touchpoint row has come back. Wait for it
  // rather than dropping the disposition on the floor.
  if(!target.interactionId && pendingTouchpoint){
    try { const row = await pendingTouchpoint; if(row) target.interactionId = row.id; } catch(e){}
  }
  await applyDisposition(target.dealId, target.interactionId, value);
  // Repaint the deal card if it happens to be the one on screen.
  const { refreshModal } = await import('./render.js?v=20260826144756');
  if(state.selectedDeal === target.dealId) refreshModal();
}

window.savePostCallDisposition = savePostCallDisposition;

export function closeJustCallWidget(){
  document.getElementById('justcall-widget').style.display = 'none';
  const d = document.getElementById('justcall-disposition');
  if(d) d.style.display = 'none';
}

export function toggleJustCallMinimize(){
  const widget = document.getElementById('justcall-widget');
  const dialer = document.getElementById('justcall-dialer');
  const btn = document.getElementById('justcall-minimize-btn');
  if(dialer.style.display === 'none'){
    dialer.style.display = '';
    widget.style.height = '90vh';
    btn.textContent = '\u2500';
  } else {
    dialer.style.display = 'none';
    widget.style.height = 'auto';
    btn.textContent = '\u25A1';
  }
}

// Expose to inline HTML handlers
window.callInJustCall = callInJustCall;
window.closeJustCallWidget = closeJustCallWidget;
window.toggleJustCallMinimize = toggleJustCallMinimize;
