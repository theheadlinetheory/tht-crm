// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Dialer (embedded iframe via SDK protocol)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc, uid, getToday } from './utils.js';
import { invokeEdgeFunction, sbCreateActivity, camelToSnake } from './api.js';
import { getHealthyNumber, getRegionForPhone, recordCallOutcome } from './number-health.js';

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
  iframe.src = DIALER_URL;
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

export async function callInJustCall(dealId){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal) return;
  const phone = str(deal.phone) || str(deal.mobilePhone);
  if(!phone){ alert('No phone number on this deal.'); return; }
  const digits = phone.replace(/\D/g, '');
  const formatted = digits.length === 10 ? '+1' + digits
    : digits.length === 11 && digits[0] === '1' ? '+' + digits
    : '+' + digits;

  // Smart number selection based on lead's area code
  const region = getRegionForPhone(formatted);
  const outboundNumber = getHealthyNumber(region);
  if(!outboundNumber){
    alert('No healthy dialer numbers for the ' + region + ' region. Check Settings \u2192 Dialer.');
    return;
  }

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
  if(regionBadge) regionBadge.textContent = region + ' \u2022 ' + formattedOutbound;

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Show iframe directly — no banner, maximum space for dialer
  dialerEl.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  // Pass numbers (destination) and from (caller ID) as URL params
  iframe.src = DIALER_URL + '?numbers=' + encodeURIComponent(formatted)
    + '&from=' + encodeURIComponent(outboundNumber)
    + '&caller_id=' + encodeURIComponent(outboundNumber);
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  dialerEl.appendChild(iframe);
  {

    // Use SDK postMessage to dial number + try to set caller ID
    const setupCall = () => {
      // Official SDK: pre-fill destination number
      sendToDialer({ type: 'dial-number', phoneNumber: formatted });

      // Undocumented: try various message types to set the outbound/from number
      const outNum = outboundNumber;
      const outDigits = outNum.replace(/\D/g, '');
      sendToDialer({ type: 'set-caller-id', callerId: outNum });
      sendToDialer({ type: 'set-caller-id', caller_id: outNum });
      sendToDialer({ type: 'set-caller-id', number: outNum });
      sendToDialer({ type: 'set-from-number', number: outNum });
      sendToDialer({ type: 'set-from-number', fromNumber: outNum });
      sendToDialer({ type: 'select-number', number: outNum });
      sendToDialer({ type: 'select-number', phoneNumber: outNum });
      sendToDialer({ type: 'change-number', number: outNum });
      sendToDialer({ type: 'set-outbound-number', number: outNum });
      sendToDialer({ type: 'set-phone-number', phoneNumber: outNum });
      sendToDialer({ type: 'switch-number', number: outNum });
      // Try with just digits
      sendToDialer({ type: 'set-caller-id', callerId: outDigits });
      sendToDialer({ type: 'select-number', number: outDigits });
    };
    // Send after delays to catch different ready states
    setTimeout(setupCall, 1500);
    setTimeout(setupCall, 3000);
    setTimeout(setupCall, 5000);
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
