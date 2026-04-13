// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Sales Dialer (embedded iframe + campaign API)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc } from './utils.js';
import { invokeEdgeFunction } from './api.js';

const SD_URL = 'https://app.justcall.io/salesdialer';
let iframeLoaded = false;

export function initJustCallDialer(){
  const container = document.getElementById('justcall-dialer');
  if(!container) return;

  // Embed Sales Dialer UI directly in the CRM widget
  const iframe = document.createElement('iframe');
  iframe.id = 'justcall-dialer-iframe';
  iframe.src = SD_URL;
  iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  iframe.onload = () => { iframeLoaded = true; };
  container.appendChild(iframe);
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

  const contactName = str(deal.contact) || str(deal.company) || '';

  // Show the widget with the embedded Sales Dialer
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  title.textContent = esc(contactName || formatted);
  widget.style.display = 'flex';

  // Make sure iframe is visible (not minimized)
  dialerEl.style.display = '';
  widget.style.height = '660px';
  const btn = document.getElementById('justcall-minimize-btn');
  if(btn) btn.textContent = '\u2500';

  // Ensure iframe exists
  if(!document.getElementById('justcall-dialer-iframe')){
    initJustCallDialer();
  }

  // Queue contact to Sales Dialer campaign via API (background)
  invokeEdgeFunction('justcall-dialer', {
    action: 'dial',
    phone: formatted,
    name: contactName,
    email: str(deal.email),
    dealId: dealId,
  }).then(result => {
    if(result && result.status === 'ok'){
      // Show brief toast notification
      showDialerToast('Contact queued: ' + (contactName || formatted), 'success');
    } else {
      showDialerToast('Queue failed: ' + (result?.error || 'Unknown error'), 'error');
    }
  }).catch(err => {
    showDialerToast('Queue error: ' + String(err), 'error');
  });
}

function showDialerToast(msg, type){
  const existing = document.getElementById('dialer-toast');
  if(existing) existing.remove();
  const color = type === 'success' ? '#059669' : '#dc2626';
  const toast = document.createElement('div');
  toast.id = 'dialer-toast';
  toast.style.cssText = 'position:absolute;bottom:8px;left:8px;right:8px;padding:8px 12px;border-radius:6px;font-size:11px;font-weight:600;color:#fff;z-index:10;text-align:center;background:' + color;
  toast.textContent = msg;
  document.getElementById('justcall-widget').appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
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
