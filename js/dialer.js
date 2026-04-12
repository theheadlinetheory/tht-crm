// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Sales Dialer (embedded iframe via SDK protocol)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc } from './utils.js';

// SDK iframe URL (same URL the official @justcall/justcall-dialer-sdk uses)
const DIALER_URL = 'https://app.justcall.io/app/macapp/dialer_events';
let dialerReady = false;
let dialerLoggedIn = false;

export function initJustCallDialer(){
  const container = document.getElementById('justcall-dialer');
  if(!container) return;

  // Create the iframe (replicating what the SDK does internally)
  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  iframe.src = DIALER_URL;
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  container.appendChild(iframe);

  // Listen for SDK events from the iframe
  window.addEventListener('message', (e) => {
    if(e.origin !== 'https://app.justcall.io') return;
    const data = e.data;
    if(!data) return;

    if(data.type === 'dialer-ready' || data.type === 'ready') {
      dialerReady = true;
    }
    if(data.type === 'login-status' || data.type === 'login') {
      dialerLoggedIn = !!data.logged_in;
      if(data.login_numbers && data.login_numbers.length > 0) {
        console.log('[JustCall] Numbers:', data.login_numbers);
      }
    }
  });

  // Fallback: assume ready after 4 seconds
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

  // Show the widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  title.textContent = esc(deal.contact || deal.company || formatted);
  widget.style.display = 'flex';

  // Send dial command to iframe via postMessage (SDK protocol)
  const iframe = document.getElementById('justcall-dialer-iframe');
  if(iframe && iframe.contentWindow) {
    setTimeout(() => {
      iframe.contentWindow.postMessage(
        { type: 'dial-number', phoneNumber: formatted },
        'https://app.justcall.io'
      );
    }, dialerReady ? 300 : 2000);
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
