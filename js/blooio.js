// ═══════════════════════════════════════════════════════════
// BLOOIO — In-CRM texting via Blooio API (thread viewer + send)
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { showToast, sbCreateActivity, sbUpdateDeal, camelToSnake } from './api.js';
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

function formatTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  if(isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if(isToday) return time;
  if(isYesterday) return 'Yesterday ' + time;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time;
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

async function fetchThread(phone){
  const e164 = formatE164(phone);
  const encoded = encodeURIComponent(e164);
  try {
    const res = await fetch(BLOOIO_BASE_URL + '/chats/' + encoded + '/messages?limit=50&sort=timestamp&direction=desc', {
      headers: { 'Authorization': 'Bearer ' + BLOOIO_API_KEY }
    });
    if(!res.ok){
      if(res.status === 404) return []; // No conversation yet
      throw new Error('Failed to load messages');
    }
    const data = await res.json();
    const messages = data.messages || data.data || data;
    if(!Array.isArray(messages)) return [];
    // Reverse so oldest first
    return messages.reverse();
  } catch(e){
    console.warn('[Blooio] Thread fetch error:', e);
    return [];
  }
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

function renderMessages(messages, containerEl){
  if(!messages || messages.length === 0){
    containerEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#9ca3af;font-size:13px">No messages yet.<br>Send the first text below.</div>';
    return;
  }
  let html = '';
  for(const msg of messages){
    // Determine direction: "outbound"/"sent" = us, "inbound"/"received" = them
    const dir = msg.direction || msg.type || '';
    const isOutbound = /outbound|sent/i.test(dir);
    const text = esc(msg.text || msg.body || msg.message || '');
    const time = formatTime(msg.timestamp || msg.created_at || msg.sent_at);
    if(!text) continue;

    if(isOutbound){
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">'
        + '<div style="max-width:80%;background:#059669;color:#fff;padding:8px 12px;border-radius:12px 12px 2px 12px;font-size:13px;line-height:1.4">'
        + text
        + '<div style="font-size:10px;opacity:.7;margin-top:3px;text-align:right">' + time + '</div>'
        + '</div></div>';
    } else {
      html += '<div style="display:flex;justify-content:flex-start;margin-bottom:8px">'
        + '<div style="max-width:80%;background:#f3f4f6;color:#111;padding:8px 12px;border-radius:12px 12px 12px 2px;font-size:13px;line-height:1.4">'
        + text
        + '<div style="font-size:10px;color:#9ca3af;margin-top:3px">' + time + '</div>'
        + '</div></div>';
    }
  }
  containerEl.innerHTML = html;
  // Scroll to bottom
  containerEl.scrollTop = containerEl.scrollHeight;
}

export function openBlooioModal(dealId, phoneField){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal) return;
  const phone = phoneField === 'mobilePhone' ? (deal.mobilePhone || deal.phone) : (deal.phone || deal.mobilePhone);
  if(!phone){ showToast('No phone number on this deal', 'error'); return; }

  // Clear reply highlight when opening thread
  if(deal.hasNewReply){
    deal.hasNewReply = false;
    pendingWrites.value++;
    sbUpdateDeal(deal.id, { has_new_reply: false })
      .catch(e => console.error('Clear reply flag failed:', e))
      .finally(() => { pendingWrites.value--; });
  }

  // Remove existing modal if any
  const existing = document.getElementById('blooio-modal');
  if(existing) existing.remove();

  const contactName = deal.contact || deal.company || 'Unknown';
  const displayPhone = formatDisplay(phone);

  const modal = document.createElement('div');
  modal.id = 'blooio-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:440px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;max-height:85vh">
      <div style="padding:14px 20px;background:#059669;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-weight:700;font-size:15px">Text — ${esc(contactName)}</div>
          <div style="font-size:12px;opacity:.85">${esc(displayPhone)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button id="blooio-refresh" title="Refresh" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 4px;opacity:.8">&#x21bb;</button>
          <button id="blooio-close" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px">&times;</button>
        </div>
      </div>
      <div id="blooio-thread" style="flex:1;overflow-y:auto;padding:16px;min-height:200px;max-height:50vh;background:#fafafa">
        <div style="text-align:center;padding:40px;color:#9ca3af;font-size:13px">Loading messages...</div>
      </div>
      <div style="border-top:1px solid #e5e7eb;padding:12px 16px;background:#fff;flex-shrink:0">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="blooio-msg" rows="2" placeholder="Type a message..." style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:inherit;resize:none;box-sizing:border-box;max-height:80px"></textarea>
          <button id="blooio-send" style="padding:8px 16px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;height:36px">Send</button>
        </div>
        <div id="blooio-error" style="color:#dc2626;font-size:11px;margin-top:4px;display:none"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const threadEl = document.getElementById('blooio-thread');
  const msgEl = document.getElementById('blooio-msg');

  // Load conversation thread
  fetchThread(phone).then(messages => {
    renderMessages(messages, threadEl);
  });

  // Focus compose
  msgEl.focus();

  // Refresh button
  document.getElementById('blooio-refresh').onclick = () => {
    threadEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px">Refreshing...</div>';
    fetchThread(phone).then(messages => renderMessages(messages, threadEl));
  };

  // Close handlers
  document.getElementById('blooio-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if(e.target === modal) modal.remove(); };

  // Enter to send (Shift+Enter for newline)
  msgEl.onkeydown = (e) => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      document.getElementById('blooio-send').click();
    }
  };

  // Send handler
  document.getElementById('blooio-send').onclick = async () => {
    const errEl = document.getElementById('blooio-error');
    const sendBtn = document.getElementById('blooio-send');
    const message = msgEl.value.trim();
    if(!message){ errEl.textContent = 'Enter a message'; errEl.style.display = ''; return; }

    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    errEl.style.display = 'none';

    try {
      await sendBlooioText(phone, message);
      msgEl.value = '';

      // Auto-create activity
      const subject = message.length > 50 ? message.substring(0, 50) + '...' : message;
      pendingWrites.value++;
      sbCreateActivity(camelToSnake({
        id: uid(), dealId, type: 'Text', subject: 'Blooio: ' + subject,
        dueDate: getToday(), done: true, completedAt: new Date().toISOString()
      })).catch(e => console.error('Create activity failed:', e)).finally(() => { pendingWrites.value--; });

      // Refresh thread to show sent message
      fetchThread(phone).then(messages => renderMessages(messages, threadEl));

      // Refresh deal modal if open
      if(state.selectedDeal && state.selectedDeal.id === dealId) refreshModal();

    } catch(e){
      errEl.textContent = e.message || 'Failed to send';
      errEl.style.display = '';
    }
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  };
}

// Expose to inline HTML handlers
window.openBlooioModal = openBlooioModal;
