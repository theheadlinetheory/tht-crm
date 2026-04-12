// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Sales Dialer (campaign-based via Edge Function)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc } from './utils.js';
import { invokeEdgeFunction } from './api.js';

let sdPopup = null; // reference to Sales Dialer popup window

export function initJustCallDialer(){
  // No iframe setup needed — Sales Dialer uses API + popup approach
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

  // Show status in the CRM widget
  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const statusEl = document.getElementById('justcall-dialer');
  title.textContent = esc(contactName || formatted);
  statusEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:20px;text-align:center">'
    + '<div style="width:32px;height:32px;border:3px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></div>'
    + '<div style="font-size:13px;font-weight:600;color:#1e293b">Queuing call to Sales Dialer...</div>'
    + '<div style="font-size:12px;color:#64748b">' + esc(formatted) + '</div>'
    + '</div>';
  widget.style.display = 'flex';

  try {
    // Push contact to Sales Dialer campaign via Edge Function
    const result = await invokeEdgeFunction('justcall-dialer', {
      action: 'dial',
      phone: formatted,
      name: contactName,
      email: str(deal.email),
      dealId: dealId,
    });

    if(result && result.status === 'ok'){
      statusEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:20px;text-align:center">'
        + '<div style="font-size:28px">&#9989;</div>'
        + '<div style="font-size:13px;font-weight:600;color:#059669">Contact queued in Sales Dialer</div>'
        + '<div style="font-size:12px;color:#64748b">' + esc(contactName) + ' &bull; ' + esc(formatted) + '</div>'
        + '<div style="font-size:11px;color:#94a3b8;margin-top:4px">Open the Sales Dialer window to start calling</div>'
        + '<button onclick="openSalesDialerUI()" style="margin-top:8px;padding:8px 20px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Open Sales Dialer</button>'
        + '</div>';
    } else {
      const errMsg = result?.error || 'Unknown error';
      statusEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:20px;text-align:center">'
        + '<div style="font-size:28px">&#10060;</div>'
        + '<div style="font-size:13px;font-weight:600;color:#dc2626">Failed to queue call</div>'
        + '<div style="font-size:12px;color:#64748b">' + esc(errMsg) + '</div>'
        + '</div>';
    }
  } catch(err){
    statusEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:20px;text-align:center">'
      + '<div style="font-size:28px">&#10060;</div>'
      + '<div style="font-size:13px;font-weight:600;color:#dc2626">Network error</div>'
      + '<div style="font-size:12px;color:#64748b">' + esc(String(err)) + '</div>'
      + '</div>';
  }
}

export function openSalesDialerUI(){
  const w = 420, h = 720;
  const left = window.screen.width - w - 20;
  const top = Math.max(0, (window.screen.height - h) / 2);
  const features = `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;

  // Reuse existing popup if still open
  if(sdPopup && !sdPopup.closed){
    sdPopup.focus();
    return;
  }
  sdPopup = window.open('https://app.justcall.io/salesdialer', 'JustCallSD', features);
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
window.openSalesDialerUI = openSalesDialerUI;
