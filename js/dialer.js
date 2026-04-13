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
    // Log ALL messages from JustCall for discovery
    console.log('[JustCall msg]', JSON.stringify(data).substring(0, 500));
    if(data.type === 'dialer-ready' || data.type === 'ready') dialerReady = true;
    if(data.type === 'login-status' || data.type === 'login') {
      if(data.login_numbers && data.login_numbers.length > 0) {
        console.log('[JustCall] Available numbers:', JSON.stringify(data.login_numbers));
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

  // Show the widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  const last4 = outboundNumber.slice(-4);
  title.textContent = esc(deal.contact || deal.company || formatted);
  widget.style.display = 'flex';
  widget.style.height = '820px';
  dialerEl.style.display = '';

  const regionBadge = document.getElementById('justcall-region-badge');
  if(regionBadge) regionBadge.textContent = region + ' (...' + last4 + ')';

  // Track current call for outcome logging
  currentCallDealId = dealId;
  currentCallNumber = outboundNumber;
  currentCallPhone = formatted;

  // Format numbers for display
  const formattedOutbound = outboundNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
  const formattedLead = formatted.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');

  // Compact banner: outbound # + lead phone side by side, then full iframe
  dialerEl.innerHTML = `<div style="background:#0f172a;padding:8px 12px;display:flex;gap:8px;border-bottom:2px solid #38bdf8">
    <div style="flex:1;min-width:0">
      <div style="font-size:9px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Use this caller ID</div>
      <div style="font-size:14px;font-weight:800;color:#38bdf8;letter-spacing:.3px;margin-top:1px">${esc(formattedOutbound)}</div>
      <div style="font-size:10px;color:#64748b">${region} \u2022 ...${last4}</div>
    </div>
    <div style="flex:1;min-width:0;background:#1e293b;padding:6px 10px;border-radius:6px;border:1px solid #334155;display:flex;align-items:center;gap:6px">
      <div style="flex:1;min-width:0">
        <div style="font-size:9px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Dial this #</div>
        <div style="font-size:14px;font-weight:800;color:#34d399;letter-spacing:.3px;margin-top:1px">${esc(formattedLead)}</div>
      </div>
      <button onclick="navigator.clipboard.writeText('${esc(digits)}').then(()=>{this.textContent='\u2713';setTimeout(()=>{this.textContent='Copy'},1500)})" style="background:#34d399;color:#0f172a;font-size:9px;font-weight:800;padding:4px 8px;border-radius:4px;border:none;cursor:pointer;text-transform:uppercase;letter-spacing:.3px;flex-shrink:0">Copy</button>
    </div>
  </div>
  <div id="justcall-dialer-frame" style="flex:1;min-height:0"></div>`;

  // Load iframe dialer
  const frameContainer = document.getElementById('justcall-dialer-frame');
  if(frameContainer){
    const iframe = document.createElement('iframe');
    iframe.id = 'justcall-dialer-iframe';
    iframe.src = DIALER_URL + '?numbers=' + encodeURIComponent(formatted);
    iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    frameContainer.appendChild(iframe);
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
    widget.style.height = '820px';
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
