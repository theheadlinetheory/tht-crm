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

export function initJustCallDialer(){
  const container = document.getElementById('justcall-dialer');
  if(!container || document.getElementById('justcall-dialer-iframe')) return;

  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  iframe.src = DIALER_URL;
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  container.appendChild(iframe);

  window.addEventListener('message', (e) => {
    if(e.origin !== 'https://app.justcall.io') return;
    const data = e.data;
    if(!data) return;
    if(data.type === 'dialer-ready' || data.type === 'ready') dialerReady = true;
    if(data.type === 'login-status' || data.type === 'login') {
      if(data.login_numbers && data.login_numbers.length > 0) {
        console.log('[JustCall] Numbers:', data.login_numbers);
      }
    }
    if(data.type === 'call-ended' || data.type === 'hangup') {
      onCallEnded();
    }
  });

  setTimeout(() => { dialerReady = true; }, 4000);
}

export function callInJustCall(dealId){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal) return;
  const phone = str(deal.phone) || str(deal.mobilePhone);
  if(!phone){ alert('No phone number on this deal.'); return; }
  const digits = phone.replace(/\D/g, '');
  const formatted = digits.length === 10 ? '+1' + digits
    : digits.length === 11 && digits[0] === '1' ? '+' + digits
    : '+' + digits;

  // Smart number selection
  const region = getRegionForPhone(formatted);
  const outboundNumber = getHealthyNumber(region);
  if(!outboundNumber){
    alert('No healthy dialer numbers for the ' + region + ' region. Check Settings \u2192 Dialer.');
    return;
  }

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Show the widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  title.textContent = esc(deal.contact || deal.company || formatted);
  widget.style.display = 'flex';
  dialerEl.style.display = '';
  widget.style.height = '660px';

  // Show region badge
  const regionBadge = document.getElementById('justcall-region-badge');
  if(regionBadge) regionBadge.textContent = region + ' ' + outboundNumber.slice(-4);

  // Ensure iframe exists
  if(!document.getElementById('justcall-dialer-iframe')){
    initJustCallDialer();
  }

  // Send dial command to iframe via postMessage (SDK protocol)
  const iframe = document.getElementById('justcall-dialer-iframe');
  if(iframe && iframe.contentWindow) {
    setTimeout(() => {
      iframe.contentWindow.postMessage(
        { type: 'dial-number', phoneNumber: formatted, fromNumber: outboundNumber },
        'https://app.justcall.io'
      );
    }, dialerReady ? 300 : 2000);
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
    widget.style.height = '660px';
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
