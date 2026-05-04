// ═══════════════════════════════════════════════════════════
// BLOOIO — In-CRM texting via Blooio API
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { showToast, sbCreateActivity, camelToSnake } from './api.js';
import { uid, getToday, esc } from './utils.js';
import { refreshModal } from './render.js';
import { BLOOIO_BASE_URL, BLOOIO_API_KEY } from './config.js';

let cachedFromNumber = null;

function formatE164(phone){
  const digits = String(phone).replace(/\D/g, '');
  if(digits.length === 10) return '+1' + digits;
  if(digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
}

function formatDisplay(phone){
  const digits = String(phone).replace(/\D/g, '');
  if(digits.length === 10) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  if(digits.length === 11 && digits[0] === '1') return '(' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7);
  return phone;
}

async function getFromNumber(){
  if(cachedFromNumber) return cachedFromNumber;
  try {
    const res = await fetch(BLOOIO_BASE_URL + '/me/numbers', {
      headers: { 'Authorization': 'Bearer ' + BLOOIO_API_KEY }
    });
    if(!res.ok) throw new Error('Failed to fetch numbers');
    const data = await res.json();
    const numbers = data.numbers || data;
    if(Array.isArray(numbers) && numbers.length > 0){
      cachedFromNumber = numbers[0].phone_number || numbers[0].number || numbers[0];
      return cachedFromNumber;
    }
  } catch(e){
    console.warn('[Blooio] Could not fetch from-number:', e);
  }
  return null;
}

async function sendBlooioText(phone, message){
  const e164 = formatE164(phone);
  const encoded = encodeURIComponent(e164);
  const fromNumber = await getFromNumber();
  const body = { text: message };
  if(fromNumber) body.from_number = fromNumber;

  const res = await fetch(BLOOIO_BASE_URL + '/chats/' + encoded + '/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + BLOOIO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Send failed (' + res.status + ')');
  }
  return await res.json();
}

export function openBlooioModal(dealId, phoneField){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal) return;
  const phone = phoneField === 'mobilePhone' ? (deal.mobilePhone || deal.phone) : (deal.phone || deal.mobilePhone);
  if(!phone){ showToast('No phone number on this deal', 'error'); return; }

  // Remove existing modal if any
  const existing = document.getElementById('blooio-modal');
  if(existing) existing.remove();

  const contactName = deal.contact || deal.company || 'Unknown';
  const displayPhone = formatDisplay(phone);

  const modal = document.createElement('div');
  modal.id = 'blooio-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">
      <div style="padding:16px 20px;background:#059669;color:#fff;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:700;font-size:15px">Text via Blooio</div>
          <div style="font-size:12px;opacity:.85">${esc(contactName)} · ${esc(displayPhone)}</div>
        </div>
        <button id="blooio-close" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px">&times;</button>
      </div>
      <div style="padding:20px">
        <textarea id="blooio-msg" rows="5" placeholder="Type your message..." style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
        <div id="blooio-error" style="color:#dc2626;font-size:12px;margin-top:6px;display:none"></div>
        <button id="blooio-send" style="margin-top:12px;width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Send Text</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Focus textarea
  document.getElementById('blooio-msg').focus();

  // Close handlers
  document.getElementById('blooio-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if(e.target === modal) modal.remove(); };

  // Send handler
  document.getElementById('blooio-send').onclick = async () => {
    const msgEl = document.getElementById('blooio-msg');
    const errEl = document.getElementById('blooio-error');
    const sendBtn = document.getElementById('blooio-send');
    const message = msgEl.value.trim();
    if(!message){ errEl.textContent = 'Enter a message'; errEl.style.display = ''; return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    errEl.style.display = 'none';

    try {
      await sendBlooioText(phone, message);
      showToast('Text sent via Blooio', 'success');

      // Auto-create activity
      const subject = message.length > 50 ? message.substring(0, 50) + '...' : message;
      pendingWrites.value++;
      sbCreateActivity(camelToSnake({
        id: uid(), dealId, type: 'Text', subject: 'Blooio: ' + subject,
        dueDate: getToday(), done: true, completedAt: new Date().toISOString()
      })).catch(e => console.error('Create activity failed:', e)).finally(() => { pendingWrites.value--; });

      // Refresh modal if deal is open
      if(state.selectedDeal && state.selectedDeal.id === dealId) refreshModal();

      modal.remove();
    } catch(e){
      errEl.textContent = e.message || 'Failed to send — check number format or try again';
      errEl.style.display = '';
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Text';
    }
  };
}

// Expose to inline HTML handlers
window.openBlooioModal = openBlooioModal;
