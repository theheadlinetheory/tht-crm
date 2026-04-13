// ═══════════════════════════════════════════════════════════
// THREADS — SmartLead thread viewer, client thread sender
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { refreshModal } from './render.js';
import { apiGet, invokeEdgeFunction } from './api.js';
import { esc } from './utils.js';

// ─── SmartLead Thread Viewer ───
let slThreadCache = {};

export async function loadSmartleadThread(dealId) {
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal||!deal.slLeadId||!deal.slCampaignId){ resetThreadBtn(dealId,'No SmartLead data'); return; }
  if(slThreadCache[dealId]) return;
  try {
    const resp=await apiGet('get_smartlead_thread&leadId='+deal.slLeadId+'&campaignId='+deal.slCampaignId);
    if(Array.isArray(resp) && resp.length){
      slThreadCache[dealId]=resp;
      refreshModal();
    } else {
      resetThreadBtn(dealId,'No thread found');
    }
  } catch(e){
    console.warn('Failed to load SmartLead thread:', e);
    resetThreadBtn(dealId,'Failed to load thread');
  }
}

function resetThreadBtn(dealId, msg){
  const btn=document.getElementById('sl-thread-btn-'+dealId);
  if(btn){ btn.disabled=false; btn.innerHTML=msg||'Retry'; btn.style.color='#9ca3af'; }
}

export function renderSmartleadThread(dealId, messages) {
  if(!messages||!messages.length) return '';
  const latest=messages[messages.length-1];
  let h=`<div style="margin-bottom:12px">
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px">EMAIL THREAD (${messages.length} messages)</div>`;
  h+=renderThreadMessage(latest, true);
  if(messages.length>1){
    h+=`<div id="full-thread-${dealId}" style="display:none">`;
    for(let i=messages.length-2;i>=0;i--){
      h+=renderThreadMessage(messages[i], false);
    }
    h+=`</div>
    <button class="btn btn-ghost" style="font-size:10px;margin-top:4px;width:100%" onclick="toggleFullThread('${dealId}')">
      Show ${messages.length-1} older message${messages.length>2?'s':''}
    </button>`;
  }
  h+=`</div>`;
  return h;
}

export function renderThreadMessage(msg, isLatest) {
  const from=msg.from||'';
  const date=msg.time||msg.date||'';
  const body=msg.text||msg.body||'';
  const isReply=from.toLowerCase().includes(msg.leadEmail||'');
  return `<div style="padding:8px 10px;margin-bottom:4px;background:${isReply?'#f0fdf4':'#f8fafc'};border:1px solid ${isReply?'#bbf7d0':'#e2e8f0'};border-radius:6px;${isReply?'border-left:3px solid #22c55e':''}">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:10px;font-weight:600;color:${isReply?'#166534':'#6b7280'}">${isReply?'Lead Reply':'Outbound'}</span>
      <span style="font-size:10px;color:#9ca3af">${esc(date)}</span>
    </div>
    <div style="font-size:12px;color:#334155;line-height:1.5;white-space:pre-wrap;max-height:${isLatest?'none':'100px'};overflow:hidden">${esc(body)}</div>
  </div>`;
}

export function toggleFullThread(dealId) {
  const el=document.getElementById('full-thread-'+dealId);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

export function getThreadCache() { return slThreadCache; }

// ─── Client Thread Sender ───
export async function openSendToClientPreview(dealId, clientName){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const { getClientThreadId, lookupClientInfo } = await import('./client-info.js');
  const { buildLeadMessage } = await import('./email.js');
  const threadId=getClientThreadId(clientName)||'';
  const info=lookupClientInfo(clientName)||{};
  const message=buildLeadMessage(deal, clientName);

  let _toEmail='Loading...';
  let _ccs=[];
  let _threadInfo='';
  try{
    const preview=await invokeEdgeFunction('send-email',{action:'preview_email_recipients',dealId:dealId,clientName:clientName,emailAction:'send_to_client_thread'});
    if(preview&&preview.ok){
      _toEmail=preview.to||'NO EMAIL CONFIGURED';
      _ccs=preview.cc||[];
      _threadInfo=preview.threadFound?('Thread: '+preview.threadSubject):'New email (no existing thread)';
    }
  }catch(e){ _toEmail='Error loading recipients'; }

  const overlay=document.createElement('div');
  overlay.id='send-preview-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="background:#fff;border-radius:12px;width:500px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:15px;font-weight:700;color:#1e293b">Send to ${esc(clientName)}</div>
        <div style="margin-top:6px;font-size:12px;line-height:1.8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px">
          <div><strong style="color:#dc2626">TO:</strong> <span style="color:#111;font-weight:600">${esc(_toEmail)}</span></div>
          <div><strong style="color:#dc2626">CC:</strong> <span style="color:#111;font-weight:600">${esc(_ccs.join(', ')||'none')}</span></div>
          <div><strong style="color:#6b7280">FROM:</strong> contact@theheadlinetheory.com</div>
          <div style="color:#6b7280;font-size:11px;margin-top:2px">${esc(_threadInfo)}</div>
        </div>
      </div>
      <button onclick="document.getElementById('send-preview-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;padding:4px">x</button>
    </div>
    <div style="padding:16px 20px">
      <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Message Preview (editable)</label>
      <textarea id="send-preview-body" rows="14" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:var(--font);line-height:1.6;resize:vertical;color:#1f2937">${esc(message)}</textarea>
    </div>
    <div style="padding:12px 20px 20px;display:flex;gap:8px">
      <button id="send-to-thread-btn" onclick="doSendToClientThread('${esc(dealId)}',atob('${btoa(unescape(encodeURIComponent(clientName)))}'),'${esc(threadId)}')" style="flex:1;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">Send to ${esc(clientName)}</button>
      <button onclick="document.getElementById('send-preview-overlay').remove()" style="padding:12px 20px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Cancel</button>
    </div>
  </div>`;
  overlay.onmousedown=function(e){ overlay._clickStartedOnBackdrop=(e.target===overlay); };
  overlay.onclick=function(e){ if(e.target===overlay && overlay._clickStartedOnBackdrop) overlay.remove(); };
  document.body.appendChild(overlay);
}

export async function doSendToClientThread(dealId, clientName, threadId){
  const btn=document.getElementById('send-to-thread-btn');
  const messageBody=document.getElementById('send-preview-body')?.value||'';
  if(!messageBody.trim()){ alert('Message is empty'); return; }

  if(btn){ btn.disabled=true; btn.textContent='Sending...'; btn.style.opacity='0.6'; }

  try {
    const result=await invokeEdgeFunction('send-email',{
      action: 'send_to_client_thread',
      dealId: dealId,
      clientName: clientName,
      threadId: threadId,
      messageBody: messageBody
    });
    if(result && result.ok){
      const deal=state.deals.find(d=>d.id===dealId);
      if(deal) deal.forwardedAt=new Date().toISOString();
      document.getElementById('send-preview-overlay')?.remove();
      if(state.selectedDeal) refreshModal(true);
      const toast=document.createElement('div');
      toast.style.cssText='position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:100001;box-shadow:0 4px 12px rgba(0,0,0,.2)';
      toast.textContent='Sent to '+clientName+'\'s thread!';
      document.body.appendChild(toast);
      setTimeout(()=>toast.remove(),4000);
    } else {
      alert('Failed to send: '+(result?.error||'Unknown error'));
      if(btn){ btn.disabled=false; btn.textContent='Send to '+clientName; btn.style.opacity='1'; }
    }
  } catch(err){
    alert('Error: '+err.message);
    if(btn){ btn.disabled=false; btn.textContent='Send to '+clientName; btn.style.opacity='1'; }
  }
}

// Expose to inline HTML handlers
window.toggleFullThread = toggleFullThread;
window.openSendToClientPreview = openSendToClientPreview;
window.doSendToClientThread = doSendToClientThread;
