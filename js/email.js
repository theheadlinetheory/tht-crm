// ═══════════════════════════════════════════════════════════
// EMAIL — Forward to client, lead tracker push, send to thread
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js?v=20260715b';
import { render, refreshModal } from './render.js?v=20260715b';
import { invokeEdgeFunction, sbUpdateDeal, camelToSnake } from './api.js?v=20260715b';
import { esc, str, svgIcon, stripHtml, applyTemplate } from './utils.js?v=20260715b';
import { DEFAULT_DELIVERY_TEMPLATE } from './settings.js?v=20260715b';
import { findClientForDeal, lookupClientInfo, getClientThreadId } from './client-info.js?v=20260715b';
import { CRM_BASE_URL, GEOCODIO_KEY } from './config.js?v=20260715b';

function formatEmailBody(html){
  if(!html) return '';
  let s=String(html);
  s=s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'');
  s=s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'');
  // Trim the quoted/forwarded thread below the lead's reply
  s=s.replace(/<div\s+class="gmail_quote[^"]*"[\s\S]*/gi,'\n---\n(earlier messages trimmed)');
  s=s.replace(/<blockquote[\s\S]*/gi,'\n---\n(earlier messages trimmed)');
  // Convert structural tags to newlines
  s=s.replace(/<br\s*\/?>/gi,'\n');
  s=s.replace(/<\/div>/gi,'\n');
  s=s.replace(/<\/p>/gi,'\n\n');
  s=s.replace(/<\/tr>/gi,'\n');
  s=s.replace(/<\/li>/gi,'\n');
  // Strip remaining tags
  s=s.replace(/<[^>]*>/g,'');
  // Decode all HTML entities via DOM parser
  const el=document.createElement('textarea');
  el.innerHTML=s;
  s=el.value;
  // Collapse excessive blank lines
  s=s.replace(/\n{3,}/g,'\n\n').trim();
  return esc(s).replace(/\n/g,'<br>');
}

export async function forwardDealToClient(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const client=findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  if(!client){alert('No client matched for this campaign. Add campaign keywords in Settings \u2192 Clients.');return;}
  if(deal.forwardedAt && str(deal.forwardedAt).trim()!=='' && !confirm('Already forwarded. Send again?')) return;
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
        ${leadMobilePhone?`<tr><td style="padding:8px 0;color:#888">Mobile Phone</td><td style="padding:8px 0">${esc(leadMobilePhone)}</td></tr>`:''}
        ${[{n:deal.contact2,t:deal.title2,e:deal.email2,p:deal.phone2},{n:deal.contact3,t:deal.title3,e:deal.email3,p:deal.phone3}].filter(c=>c.n||c.e||c.p).map(c=>`
        <tr><td colspan="2" style="padding:12px 0 4px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Additional Contact</td></tr>
        ${c.n?`<tr><td style="padding:8px 0;color:#888">Name</td><td style="padding:8px 0;font-weight:600">${esc(c.n)}${c.t?' \u2014 '+esc(c.t):''}</td></tr>`:''}
        ${c.e?`<tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#2563eb">${esc(c.e)}</td></tr>`:''}
        ${c.p?`<tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${esc(c.p)}</td></tr>`:''}`).join('')}
        ${deal.email4?`<tr><td style="padding:8px 0;color:#888">Additional Email</td><td style="padding:8px 0;color:#2563eb">${esc(deal.email4)}</td></tr>`:''}
      </table>
      <div style="margin-top:20px">
        ${smartleadUrl?`<span style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px">Click to Reply \u2192</span>`:''}
        ${str(client.enableCrmLink).toUpperCase()==='TRUE'?`<span style="display:inline-block;background:#fff;color:#2563eb;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px;border:2px solid #2563eb;margin-left:8px">View in CRM \u2192</span>`:''}
      </div>
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

async function resolveCountyPrice(address, countyPricing) {
  if (!address || !countyPricing) return null;
  try {
    const resp = await fetch(`https://api.geocod.io/v1.7/geocode?q=${encodeURIComponent(address)}&fields=county&api_key=${GEOCODIO_KEY}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const county = data.results?.[0]?.address_components?.county;
    const state = data.results?.[0]?.address_components?.state;
    if (!county) return null;
    const key = `${county}, ${state}`;
    if (key in countyPricing) return countyPricing[key];
    const countyOnly = county.replace(/ County$/i, '') + ' County';
    for (const [k, v] of Object.entries(countyPricing)) {
      if (k.toLowerCase().startsWith(countyOnly.toLowerCase())) return v;
    }
    return null;
  } catch (e) {
    console.warn('County pricing lookup failed:', e);
    return null;
  }
}

export async function autoPushToTracker(deal){
  const client=findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  const clientName = deal.pipeline==='Acquisition' ? (deal.company||deal.contact||'Unknown') : (client?client.name:deal.stage);
  if(!clientName){console.warn('No client name for tracker push');return;}
  const leadName=deal.company||deal.contact||'Unknown';
  const leadEmail=deal.email||'';

  // Generate date strings
  const now = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateAdded = `${now.getMonth()+1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`;

  // Look up lead cost — county-based pricing takes priority
  let leadCost = '$0';
  if (client) {
    const baseCost = str(client.leadCost).trim() ? `$${str(client.leadCost).replace(/[^0-9.]/g,'')}` : '$0';
    const countyPricing = client.countyPricing;
    const address = deal.location || deal.address || '';
    if (countyPricing && address) {
      const countyRate = await resolveCountyPrice(address, countyPricing);
      leadCost = countyRate !== null ? `$${countyRate}` : baseCost;
    } else {
      leadCost = baseCost;
    }
  }

  // Build appointment date and time from deal's booked date/time
  let apptTime = '';
  let apptDate = '';
  if (deal.bookedDate && /^\d{4}-\d{2}-\d{2}$/.test(deal.bookedDate)) {
    const dt = new Date(deal.bookedDate + 'T' + (deal.bookedTime || '12:00'));
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const datePart = dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const timePart = deal.bookedTime ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    apptTime = timePart ? `${dayName}, ${datePart}, ${timePart}` : `${dayName}, ${datePart}`;
    apptDate = `${dt.getMonth()+1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`;
  }

  // Billing month = appointment month if available, else push month
  const billingDate = apptDate ? new Date(deal.bookedDate + 'T12:00') : now;
  const month = `${months[billingDate.getMonth()]}/${String(billingDate.getFullYear()).slice(-2)}`;

  // Insert into lead_tracker table
  const { sbCreateTrackerEntry, normalizeRow } = await import('./api.js?v=20260715b');
  const entry = await sbCreateTrackerEntry({
    deal_id: deal.id,
    client_name: clientName,
    month: month,
    lead_name: leadName,
    lead_email: leadEmail,
    date_added: dateAdded,
    lead_cost: leadCost,
    appt_time: apptTime,
    appt_date: apptDate,
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
  const template = state.savedSettings?.delivery_template || DEFAULT_DELIVERY_TEMPLATE;
  return applyTemplate(template, deal, clientName, clientFirst);
}

export async function openPassOffPreview(dealId, clientName){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===clientName);
  if(!client){alert('No client matched.');return;}

  const info=lookupClientInfo(client.name)||{};
  const rawNotify=str(client.notifyEmails).trim();
  const isEmail=rawNotify && rawNotify.includes('@') && !rawNotify.startsWith('http');
  const recipientTo=info.forwardEmail||(isEmail?rawNotify:'')||'NO EMAIL CONFIGURED';
  const recipientCCs=['aidan@theheadlinetheory.com','lars@theheadlinetheory.com'];
  const threadId=getClientThreadId(client.name);

  const forwarded=deal.forwardedAt && str(deal.forwardedAt).trim()!=='';
  const ghlPushed=deal.pushedToGhl && str(deal.pushedToGhl).trim()!=='';
  const ghlConfigured=client.ghlConfigured||(str(client.ghlLocationId).trim()&&str(client.ghlApiKey).trim());

  const fwdStatus=forwarded?`<span style="color:#059669">Already forwarded ${new Date(deal.forwardedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>`:'Forward lead email to '+esc(client.name);
  const ghlStatus=!ghlConfigured?'<span style="color:#9ca3af">GHL not configured — skip</span>':ghlPushed?'<span style="color:#059669">Already pushed to GHL — will update</span>':'Push contact + opportunity to GHL';
  const hasSheet=!!str(client.clientSheetId).trim();
  const sheetPushed=deal.pushedToTracker && str(deal.pushedToTracker).trim()!=='';
  const sheetStatus=!hasSheet?'<span style="color:#9ca3af">No client sheet — skip</span>':sheetPushed?'<span style="color:#059669">Already pushed to client sheet — will update</span>':'Push to '+esc(client.name)+"'s Lead Tracker + log pass-off";

  const companyName=deal.company||'Unknown Company';
  const contactName=deal.contact||'';
  const leadEmail=deal.email||'';
  const leadPhone=deal.phone||'';
  const leadMobilePhone=deal.mobilePhone||'';
  const leadWebsite=deal.website||'';
  const leadLocation=deal.location||'';
  const smartleadUrl=deal.smartleadUrl||'';
  const emailBody=deal.emailBody||'';

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
        ${leadMobilePhone?`<tr><td style="padding:8px 0;color:#888">Mobile Phone</td><td style="padding:8px 0">${esc(leadMobilePhone)}</td></tr>`:''}
        ${[{n:deal.contact2,t:deal.title2,e:deal.email2,p:deal.phone2},{n:deal.contact3,t:deal.title3,e:deal.email3,p:deal.phone3}].filter(c=>c.n||c.e||c.p).map(c=>`
        <tr><td colspan="2" style="padding:12px 0 4px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Additional Contact</td></tr>
        ${c.n?`<tr><td style="padding:8px 0;color:#888">Name</td><td style="padding:8px 0;font-weight:600">${esc(c.n)}${c.t?' — '+esc(c.t):''}</td></tr>`:''}
        ${c.e?`<tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#2563eb">${esc(c.e)}</td></tr>`:''}
        ${c.p?`<tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${esc(c.p)}</td></tr>`:''}`).join('')}
        ${deal.email4?`<tr><td style="padding:8px 0;color:#888">Additional Email</td><td style="padding:8px 0;color:#2563eb">${esc(deal.email4)}</td></tr>`:''}
      </table>
      ${emailBody?`<div style="margin:16px 0;padding:12px 16px;background:#f3f4f6;border-left:3px solid #4f46e5;border-radius:4px;font-size:13px;color:#374151;overflow-y:auto;max-height:300px"><strong>Their reply:</strong><br>${formatEmailBody(emailBody)}</div>`:''}
      <div style="margin-top:20px">
        ${smartleadUrl?`<span style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px">Click to Reply →</span>`:''}
        ${str(client.enableCrmLink).toUpperCase()==='TRUE'?`<span style="display:inline-block;background:#fff;color:#2563eb;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px;border:2px solid #2563eb;margin-left:8px">View in CRM →</span>`:''}
      </div>
      <p style="margin-top:20px;color:#888;font-size:12px">Go get em while they're hot!</p>
    </div>`;

  const overlay=document.createElement('div');
  overlay.id='passoff-preview-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="background:#fff;border-radius:12px;width:560px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:15px;font-weight:700;color:#1e293b">Pass Off: ${esc(deal.company||deal.contact||'Lead')} → ${esc(client.name)}</div>
        <div style="margin-top:6px;font-size:12px;line-height:1.8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px">
          <div><strong style="color:#dc2626">TO:</strong> <span style="color:#111;font-weight:600">${esc(recipientTo)}</span></div>
          <div><strong style="color:#dc2626">CC:</strong> <span style="color:#111;font-weight:600">${esc(recipientCCs.join(', '))}</span></div>
          <div><strong style="color:#6b7280">FROM:</strong> contact@theheadlinetheory.com</div>
          <div style="color:#6b7280;font-size:11px;margin-top:2px">${threadId?'Thread: Lead Delivery - '+esc(client.name):'New email (no existing thread)'}</div>
        </div>
      </div>
      <button onclick="document.getElementById('passoff-preview-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;padding:4px">×</button>
    </div>
    <div style="padding:20px">
      <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">
        ${emailPreview}
      </div>
    </div>
    <div style="padding:0 20px 16px">
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">What happens</div>
      <div style="font-size:12px;color:#374151;line-height:2">
        <div>1. ${fwdStatus}</div>
        <div>2. ${ghlStatus}</div>
        <div>3. ${sheetStatus}</div>
        <div>4. Archive deal from active pipeline</div>
      </div>
    </div>
    <div style="padding:12px 20px 20px;display:flex;gap:8px">
      <button id="passoff-confirm-btn" onclick="executePassOff('${esc(deal.id)}',atob('${btoa(unescape(encodeURIComponent(client.name)))}'))" style="flex:1;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">Pass Off to ${esc(client.name)}</button>
      <button onclick="document.getElementById('passoff-preview-overlay').remove()" style="padding:12px 20px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Cancel</button>
    </div>
  </div>`;
  overlay.onmousedown=function(e){overlay._bg=(e.target===overlay);};
  overlay.onclick=function(e){if(e.target===overlay&&overlay._bg)overlay.remove();};
  document.body.appendChild(overlay);
}

export async function executePassOff(dealId, clientName){
  const btn=document.getElementById('passoff-confirm-btn');
  if(btn){btn.disabled=true;btn.textContent='Passing off...';btn.style.opacity='0.6';}

  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal){alert('Deal not found');return;}
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===clientName);
  if(!client){alert('Client not found');return;}

  try{
    if(!deal.forwardedAt || str(deal.forwardedAt).trim()===''){
      if(btn) btn.textContent='Forwarding...';
      const resp=await invokeEdgeFunction('send-email',{action:'forward_to_client',dealId:dealId,clientId:client.id||''});
      if(!resp||resp.error) throw new Error('Forward failed: '+(resp?.error||'No response'));
      deal.forwardedAt=new Date().toISOString();
    }

    const ghlConfigured=client.ghlConfigured||(str(client.ghlLocationId).trim()&&str(client.ghlApiKey).trim());
    if(ghlConfigured){
      if(btn) btn.textContent='Pushing to GHL...';
      try{
        const ghlResp=await invokeEdgeFunction('push-to-ghl',{dealId:dealId});
        if(ghlResp&&ghlResp.error) console.warn('GHL push warning:',ghlResp.error);
      }catch(ghlErr){
        console.warn('GHL push skipped during pass-off:',ghlErr.message);
      }
    }

    // Push to client sheet (logs to pass_offs for retainer clients)
    const hasSheet=str(client.clientSheetId).trim();
    if(hasSheet){
      if(btn) btn.textContent='Pushing to client sheet...';
      try{
        await invokeEdgeFunction('push-to-client-sheet',{dealId:dealId});
      }catch(sheetErr){
        console.warn('Client sheet push skipped during pass-off:',sheetErr.message);
      }
    }

    if(btn) btn.textContent='Archiving...';
    const { deleteDeal }=await import('./deals.js?v=20260715b');
    await deleteDeal(dealId,'Passed Off',clientName);

    document.getElementById('passoff-preview-overlay')?.remove();
    const toast=document.createElement('div');
    toast.style.cssText='position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:100001;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    toast.textContent='Passed off '+(deal.company||deal.contact||'lead')+' to '+clientName;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),4000);
  }catch(e){
    alert('Pass-off failed: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='Pass Off to '+clientName;btn.style.opacity='1';}
  }
}

// Expose to inline HTML handlers
window.forwardDealToClient = forwardDealToClient;
window.confirmForward = confirmForward;
window.autoPushToTracker = autoPushToTracker;
window.openPassOffPreview = openPassOffPreview;
window.executePassOff = executePassOff;
