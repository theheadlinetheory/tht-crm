// ═══════════════════════════════════════════════════════════
// EMAIL — Forward to client, lead tracker push, send to thread
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { render, refreshModal } from './render.js';
import { invokeEdgeFunction, sbUpdateDeal, camelToSnake } from './api.js';
import { esc, str, svgIcon, stripHtml } from './utils.js';
import { findClientForDeal, lookupClientInfo, getClientThreadId } from './client-info.js';

export async function forwardDealToClient(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const client=findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  if(!client){alert('No client matched for this campaign. Add campaign keywords in Settings \u2192 Clients.');return;}
  if(deal.forwardedAt && str(deal.forwardedAt).trim()!==''){alert('Already forwarded.');return;}
  showForwardPreview(deal, client);
}

function showForwardPreview(deal, client){
  const overlay=document.createElement('div');
  overlay.id='fwd-preview-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:20000;display:flex;align-items:center;justify-content:center';
  overlay.onclick=e=>{if(e.target===overlay){overlay.remove();}};

  const companyName=deal.company||'Unknown Company';
  const contactName=deal.contact||'';
  const leadEmail=deal.email||'';
  const leadPhone=deal.phone||'';
  const leadMobilePhone=deal.mobilePhone||'';
  const leadWebsite=deal.website||'';
  const leadLocation=deal.location||'';
  const smartleadUrl=deal.smartleadUrl||'';

  const info=lookupClientInfo(client.name)||{};
  const rawNotify=str(client.notifyEmails).trim();
  const isEmail=rawNotify && rawNotify.includes('@') && !rawNotify.startsWith('http');
  const recipientTo=info.forwardEmail || (isEmail ? rawNotify : '') || 'NO EMAIL CONFIGURED';
  const recipientCCs=['aidan@theheadlinetheory.com','lars@theheadlinetheory.com'];
  const threadId=getClientThreadId(client.name);
  const recipientThread=threadId ? 'Lead Delivery Thread' : 'New email (no existing thread)';

  const leadEmail2=deal.email2||'';
  const leadEmail3=deal.email3||'';
  const leadEmail4=deal.email4||'';
  let emailPreview=`
    <div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0;font-size:18px">New Lead from Your Campaign</h2>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;width:140px">Business</td><td style="padding:8px 0;font-weight:bold">${esc(companyName)}</td></tr>
        ${leadWebsite?`<tr><td style="padding:8px 0;color:#888">Website</td><td style="padding:8px 0;color:#2563eb">${esc(leadWebsite)}</td></tr>`:''}
        ${leadLocation?`<tr><td style="padding:8px 0;color:#888">Address</td><td style="padding:8px 0">${esc(leadLocation)}</td></tr>`:''}
        ${leadEmail?`<tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#2563eb">${esc(leadEmail)}</td></tr>`:''}
        ${leadPhone?`<tr><td style="padding:8px 0;color:#888">Business Phone</td><td style="padding:8px 0">${esc(leadPhone)}</td></tr>`:''}
        ${contactName?`<tr><td style="padding:8px 0;color:#888">Contact</td><td style="padding:8px 0">${esc(contactName)}</td></tr>`:''}
        ${leadEmail2?`<tr><td style="padding:8px 0;color:#888">Contact email</td><td style="padding:8px 0;color:#2563eb">${esc(leadEmail2)}</td></tr>`:''}
        ${leadEmail3?`<tr><td style="padding:8px 0;color:#888">Email 3</td><td style="padding:8px 0;color:#2563eb">${esc(leadEmail3)}</td></tr>`:''}
        ${leadEmail4?`<tr><td style="padding:8px 0;color:#888">Email 4</td><td style="padding:8px 0;color:#2563eb">${esc(leadEmail4)}</td></tr>`:''}
        ${leadMobilePhone?`<tr><td style="padding:8px 0;color:#888">Mobile Phone</td><td style="padding:8px 0">${esc(leadMobilePhone)}</td></tr>`:''}
      </table>
      ${smartleadUrl?`<div style="margin-top:20px"><span style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px">Click to Reply \u2192</span></div>`:''}
      <p style="margin-top:20px;color:#888;font-size:12px">Go get em while they're hot!</p>
    </div>`;

  const missing=[];
  if(!contactName) missing.push('Contact Name');
  if(!leadEmail) missing.push('Email');
  if(!leadPhone && !leadMobilePhone) missing.push('Phone (Business or Mobile)');
  if(!leadWebsite) missing.push('Website');
  if(!leadLocation) missing.push('Address');
  if(!smartleadUrl) missing.push('Smartlead Reply Link');

  let warningHtml='';
  if(missing.length){
    warningHtml=`<div style="padding:10px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin-bottom:14px;font-size:12px;color:#92400e">
      \u26A0\uFE0F Missing fields: ${missing.join(', ')}
    </div>`;
  }

  const modal=document.createElement('div');
  modal.style.cssText='background:#fff;border-radius:12px;width:560px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)';
  modal.innerHTML=`
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <div>
        <h3 style="margin:0;font-size:16px;color:#111">Preview: Email to ${esc(client.name)}</h3>
        <div style="margin-top:6px;font-size:12px;line-height:1.8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px">
          <div><strong style="color:#dc2626">TO:</strong> <span style="color:#111;font-weight:600">${esc(recipientTo)}</span></div>
          <div><strong style="color:#dc2626">CC:</strong> <span style="color:#111;font-weight:600">${esc(recipientCCs.join(', ')||'none')}</span></div>
          <div><strong style="color:#6b7280">FROM:</strong> contact@theheadlinetheory.com</div>
          <div style="color:#6b7280;font-size:11px;margin-top:2px">${esc(recipientThread)}</div>
        </div>
      </div>
      <button onclick="this.closest('#fwd-preview-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;padding:4px">\u00D7</button>
    </div>
    <div style="padding:20px">
      ${warningHtml}
      <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">
        ${emailPreview}
      </div>
    </div>
    <div style="padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px">
      <button onclick="this.closest('#fwd-preview-overlay').remove()" class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb">Cancel</button>
      <button id="fwd-confirm-btn" onclick="confirmForward('${deal.id}')" class="btn forward-btn ready" style="width:auto;padding:8px 24px">${svgIcon('mail',14)} Send to ${esc(client.name)}</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export async function confirmForward(dealId){
  const btn=document.getElementById('fwd-confirm-btn');
  if(btn){btn.textContent='Sending...';btn.disabled=true;}

  try{
    const deal=state.deals.find(d=>d.id===dealId);
    const client=deal ? (findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage)) : null;
    const resp=await invokeEdgeFunction('send-email',{action:'forward_to_client', dealId:dealId, clientId: client ? client.id : ''});
    if(!resp || resp.error){
      const errMsg=resp?resp.error:'No response from server \u2014 check Apps Script deployment';
      alert('Forward failed: '+errMsg);
      if(btn){btn.innerHTML=svgIcon('mail',14)+' Retry';btn.disabled=false;}
      return;
    }
    if(deal) deal.forwardedAt=new Date().toISOString();
    document.getElementById('fwd-preview-overlay')?.remove();
    refreshModal();
  }catch(e){
    alert('Forward failed: '+e.message);
    if(btn){btn.innerHTML=svgIcon('mail',14)+' Retry';btn.disabled=false;}
  }
}

export async function autoPushToTracker(deal){
  const client=findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  const clientName = deal.pipeline==='Acquisition' ? (deal.company||deal.contact||'Unknown') : (client?client.name:deal.stage);
  if(!clientName){console.warn('No client name for tracker push');return;}
  const leadName=deal.company||deal.contact||'Unknown';
  const leadEmail=deal.email||'';

  // Generate month and date strings
  const now = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month = `${months[now.getMonth()]}/${String(now.getFullYear()).slice(-2)}`;
  const dateAdded = `${now.getMonth()+1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`;

  // Look up lead cost from client record
  const leadCost = client && str(client.leadCost).trim() ? `$${str(client.leadCost).replace(/[^0-9.]/g,'')}` : '$0';

  // Insert into lead_tracker table
  const { sbCreateTrackerEntry, normalizeRow } = await import('./api.js');
  const entry = await sbCreateTrackerEntry({
    deal_id: deal.id,
    client_name: clientName,
    month: month,
    lead_name: leadName,
    lead_email: leadEmail,
    date_added: dateAdded,
    lead_cost: leadCost,
  });

  // Update deal
  deal.pushedToTracker=new Date().toISOString();
  pendingWrites.value++;
  sbUpdateDeal(deal.id, camelToSnake({pushedToTracker:deal.pushedToTracker})).catch(e=>console.error('Update deal failed:',e)).finally(()=>{pendingWrites.value--;});

  // Add to local state if tracker is loaded
  if(state.trackerLoaded && entry){
    state.trackerEntries.unshift(normalizeRow(entry));
  }

  // Fire-and-forget sheet sync
  invokeEdgeFunction('sync-lead-tracker',{action:'sync-row',entryId:entry.id}).catch(e=>console.warn('Sheet sync failed:',e));

  console.log('Lead Tracker push success:',leadName,'→',clientName);
}

export function buildLeadMessage(deal, clientName){
  const client=state.clients.find(c=>c.name===deal.stage)||state.clients.find(c=>c.name===clientName);
  const clientFirst=client&&str(client.contactFirstName).trim()?str(client.contactFirstName).trim():'there';
  const biz=deal.company||deal.contact||'';
  // Build the time portion
  let timeStr='';
  if(deal.bookedDate && deal.bookedDate.match(/^\d{4}-\d{2}-\d{2}$/)){
    const dt=new Date(deal.bookedDate+'T'+(deal.bookedTime||'12:00'));
    const dayName=dt.toLocaleDateString('en-US',{weekday:'long'});
    const dayPart=dt.toLocaleDateString('en-US',{month:'long',day:'numeric'});
    const timePart=deal.bookedTime?dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
    const todayDate=new Date();
    const diffDays=Math.round((dt-todayDate)/(1000*60*60*24));
    const prefix=diffDays>=0&&diffDays<=7?'This '+dayName:diffDays>7&&diffDays<=14?'Next '+dayName:dayName;
    timeStr=timePart?prefix+', '+dayPart+' at '+timePart:prefix+', '+dayPart;
  }
  const lines=[];
  if(timeStr){
    lines.push('Hey '+clientFirst+', just scheduled a quote request for '+timeStr+' with '+biz+'. The address, phone, contact info and instructions are all included in that calendar event. I\'ve also added you to the email thread. Please check your spam folder if you are not seeing it.');
  } else {
    lines.push('Hey '+clientFirst+', just scheduled a quote request for [Day] at [Time] with '+biz+'. The address, phone, contact info and instructions are all included in that calendar event. I\'ve also added you to the email thread. Please check your spam folder if you are not seeing it.');
  }
  lines.push('');
  if(str(deal.calNotes).trim()){
    lines.push(deal.calNotes.trim());
  } else {
    if(biz) lines.push('Business: '+biz);
    if(deal.website) lines.push('Website: '+deal.website);
    const addr=str(deal.address||deal.location||'').trim();
    if(addr) lines.push('Address: '+addr);
    if(deal.email) lines.push('Email: '+deal.email);
    if(deal.phone) lines.push('Business Phone: '+deal.phone);
    if(deal.contact && deal.contact !== biz) lines.push('Contact: '+deal.contact);
    if(deal.email2) lines.push('Contact email: '+deal.email2);
    if(deal.mobilePhone) lines.push('Mobile Phone: '+deal.mobilePhone);
    if(str(deal.notes).trim()) lines.push('Instructions: '+deal.notes);
  }
  if(str(deal.emailBody).trim()){
    let reply = stripHtml(deal.emailBody);
    // Remove base64 blocks (MIME-encoded attachments/images that leak into email body)
    reply = reply.replace(/[A-Za-z0-9+/=]{50,}/g, '').replace(/\s{2,}/g, ' ').trim();
    if(reply) lines.push('\nTheir Reply:\n'+reply);
  }
  return lines.join('\n');
}

// Expose to inline HTML handlers
window.forwardDealToClient = forwardDealToClient;
window.confirmForward = confirmForward;
window.autoPushToTracker = autoPushToTracker;
