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

  // Show the widget with call status
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  const last4 = outboundNumber.slice(-4);
  title.textContent = esc(deal.contact || deal.company || formatted);
  widget.style.display = 'flex';
  widget.style.height = '660px';
  dialerEl.style.display = '';

  const regionBadge = document.getElementById('justcall-region-badge');
  if(regionBadge) regionBadge.textContent = region + ' (...' + last4 + ')';

  // Show "Connecting..." status in the dialer area
  dialerEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;color:#94a3b8;font-family:var(--font,system-ui)">
    <div style="font-size:14px;font-weight:600;color:#e2e8f0">Connecting call...</div>
    <div style="font-size:24px;font-weight:700;color:#fff;letter-spacing:1px">${esc(formatted)}</div>
    <div style="font-size:12px;color:#38bdf8;background:rgba(56,189,248,.15);padding:4px 12px;border-radius:6px;font-weight:600">via ${region} (...${last4})</div>
    <div class="loading-spinner" style="margin-top:8px"></div>
    <div id="call-status-text" style="font-size:12px;color:#64748b;margin-top:4px">Ringing your JustCall app...</div>
  </div>`;

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Initiate call via JustCall API (server-side) with exact from/to numbers
  try {
    const result = await invokeEdgeFunction('justcall-dialer', {
      action: 'make-call',
      to: formatted,
      from: outboundNumber,
    });

    if(result.status === 'ok'){
      updateCallStatus('Call connected — answer in your JustCall app', '#22c55e');
      // Show the iframe dialer for call controls (mute, hold, transfer)
      setTimeout(()=>{
        showDialerIframe(formatted);
      }, 2000);
    } else {
      const errMsg = result.data?.message || result.data?.error || JSON.stringify(result.data);
      updateCallStatus('Call failed: ' + errMsg, '#ef4444');
      console.warn('[Dialer] make-call failed:', result);
      // Fall back to iframe dialer
      setTimeout(()=>{ showDialerIframe(formatted); }, 1500);
    }
  } catch(e){
    console.warn('[Dialer] make-call error:', e);
    updateCallStatus('API error — opening dialer...', '#f59e0b');
    // Fall back to iframe dialer
    setTimeout(()=>{ showDialerIframe(formatted); }, 1500);
  }
}

function updateCallStatus(msg, color){
  const el = document.getElementById('call-status-text');
  if(el){ el.textContent = msg; el.style.color = color || '#64748b'; }
}

function showDialerIframe(phoneNumber){
  const dialerEl = document.getElementById('justcall-dialer');
  if(!dialerEl) return;
  dialerEl.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  iframe.src = DIALER_URL + '?numbers=' + encodeURIComponent(phoneNumber);
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  dialerEl.appendChild(iframe);
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
