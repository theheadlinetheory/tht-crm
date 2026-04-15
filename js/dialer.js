// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Dialer (embedded iframe via SDK protocol)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc, uid, getToday } from './utils.js';
import { invokeEdgeFunction, sbCreateActivity, camelToSnake } from './api.js';
import { getBestNumberForLead, getRegionForPhone, recordCallOutcome } from './number-health.js';
import { JUSTCALL_USER_MAP } from './config.js';
import { currentUser } from './auth.js';

const DIALER_URL = 'https://app.justcall.io/dialer';
let dialerReady = false;
let currentCallDealId = null;
let currentCallNumber = null; // outbound number used
let currentCallPhone = null;  // lead's phone
let justcallNumbers = [];     // numbers available in JustCall account

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
  const bestNumber = getBestNumberForLead(formatted);
  if(!bestNumber){
    alert('No healthy dialer numbers available. Check Settings \u2192 Dialer.');
    return;
  }
  const outboundNumber = bestNumber.number;

  // Show the widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  const last4 = outboundNumber.slice(-4);
  const formattedOutbound = outboundNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');

  title.textContent = deal.contact || deal.company || formatted;
  widget.style.display = 'flex';
  widget.style.height = '90vh';
  dialerEl.style.display = '';

  const regionBadge = document.getElementById('justcall-region-badge');
  if(regionBadge) regionBadge.textContent = 'From: ' + formattedOutbound + (bestNumber.region ? ' (' + bestNumber.region + ')' : '');

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Reuse persistent iframe — keeps JustCall session + call controls alive
  const iframe = getOrCreateIframe();
  if(!dialerEl.contains(iframe)){
    dialerEl.innerHTML = '';
    dialerEl.appendChild(iframe);
  }

  // Use SDK postMessage to dial number
  const setupCall = () => {
    sendToDialer({ type: 'dial-number', phoneNumber: formatted });
  };
  // Send after delays to ensure iframe is ready
  if(dialerReady){
    setTimeout(setupCall, 500);
  } else {
    setTimeout(setupCall, 2000);
    setTimeout(setupCall, 4000);
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

  // Wait for JustCall to log the call
  await new Promise(r => setTimeout(r, 3000));

  try {
    const result = await invokeEdgeFunction('justcall-dialer', {
      action: 'call-log',
      phone: phone,
    });
    const call = result?.call;
    const wasAnswered = call?.type === 'answered';
    const duration = call?.duration || 0;
    const outcome = call?.type || 'unknown';

    // Record health stats
    await recordCallOutcome(number, wasAnswered);

    // Create activity on the deal
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

    // Refresh modal if open on this deal
    const { refreshModal } = await import('./render.js');
    if(state.selectedDeal === dealId) refreshModal();
  } catch(e){
    console.warn('[Dialer] Failed to log call outcome:', e);
  }
}

export function closeJustCallWidget(){
  document.getElementById('justcall-widget').style.display = 'none';
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
