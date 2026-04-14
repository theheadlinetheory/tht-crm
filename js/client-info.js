// ═══════════════════════════════════════════════════════════
// CLIENT-INFO — Client data, thread IDs, lookup functions
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites, deletedClientIds } from './app.js';
import { CLIENT_PALETTE } from './config.js';
import { render } from './render.js';
import { str, uid, esc, isValidDate, getToday, svgIcon } from './utils.js';
import { sbCreateClient, sbDeleteClient, camelToSnake } from './api.js';
import { isClient } from './auth.js';

// ─── Client Config (loaded from Supabase client_config table) ───
let _clientConfigCache = [];
let _clientConfigLoaded = false;

export async function loadClientConfig() {
  try {
    const { sbGetClientConfig } = await import('./api.js');
    const data = await sbGetClientConfig();
    if (Array.isArray(data)) _clientConfigCache = data;
    _clientConfigLoaded = true;
  } catch (e) { console.warn('Failed to load client config:', e); }
}

export function getClientConfig(name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  const nStripped = n.replace(/[^a-z0-9]/g, '');
  return _clientConfigCache.find(c => {
    const cn = (c.client_name || '').toLowerCase();
    const cnStripped = cn.replace(/[^a-z0-9]/g, '');
    // Exact match, substring match, or stripped match (handles apostrophes/spaces)
    return cn === n || n.includes(cn) || cn.includes(n)
      || cnStripped === nStripped || nStripped.includes(cnStripped) || cnStripped.includes(nStripped);
  }) || null;
}

export function getClientThreadId(name) {
  const cfg = getClientConfig(name);
  return cfg?.gmail_thread_id || '';
}

export function isZeroCostClient(name) {
  const cfg = getClientConfig(name);
  return cfg?.zero_cost === true;
}

export const CLIENT_THREAD_IDS = new Proxy({}, { get: (_, prop) => typeof prop === 'string' ? getClientThreadId(prop) : undefined });

// Look up client info — merges client_config (DB) with synced client data
// client_config fields take priority; synced client data fills any gaps
export function lookupClientInfo(name){
  if(!name) return null;
  const cfg = getClientConfig(name);

  // Build fallback from synced client data
  const n=name.toLowerCase().trim();
  const sc=state.clients.find(c=>{
    const cn=c.name.toLowerCase().trim();
    return cn===n||n.includes(cn)||cn.includes(n);
  });
  let fallback = null;
  if(sc){
    const notes=str(sc.clientNotes);
    let parsedLocation='',parsedServices=[],parsedServiceArea='',parsedPricing='';
    if(notes){
      const sections=notes.split('\n\n');
      for(const sec of sections){
        const lines=sec.split('\n').map(l=>l.trim()).filter(Boolean);
        if(!lines.length) continue;
        const header=lines[0].toLowerCase();
        if(header==='services'&&lines.length>1){
          parsedServices=lines.slice(1).map(l=>l.replace(/^[\u2022\-\*]\s*/,'').trim()).filter(Boolean);
        } else if(header==='service area'&&lines.length>1){
          parsedServiceArea=lines.slice(1).join(', ');
        } else if(header==='pricing'&&lines.length>1){
          parsedPricing=lines.slice(1).join(' | ');
        } else if(header==='contact'&&lines.length>1){
          const locLine=lines.find(l=>/\(EST\)|\(CST\)|\(MST\)|\(PST\)/i.test(l));
          if(locLine) parsedLocation=locLine.replace(/\s*\([A-Z]{2,4}\)\s*$/,'').trim();
        }
      }
    }
    fallback = {
      timeZone:sc.timeZone||'',
      location:parsedLocation||str(sc.location).trim()||'',
      primaryContact:str(sc.contactFirstName).trim()||'',
      primaryEmail:str(sc.notifyEmail).trim()||'',
      forwardEmail:str(sc.notifyEmail).trim()||'',
      phone:'',
      calendlyUrl:str(sc.calendlyUrl).trim()||'',
      website:str(sc.website).trim()||'',
      services:parsedServices.length?parsedServices:undefined,
      serviceAreaCities:parsedServiceArea||'',
      pricingModel:parsedPricing||'',
      warmCallNotes:[]
    };
  }

  if (cfg) {
    const fb = fallback || {};
    return {
      primaryContact: cfg.primary_contact || fb.primaryContact || '',
      primaryEmail: cfg.primary_email || fb.primaryEmail || '',
      phone: cfg.phone || fb.phone || '',
      location: cfg.location || fb.location || '',
      timeZone: cfg.time_zone || fb.timeZone || '',
      serviceAreaCities: cfg.service_area_cities || fb.serviceAreaCities || '',
      forwardName: cfg.forward_name || '',
      forwardEmail: cfg.forward_email || fb.forwardEmail || '',
      calendlyUrl: cfg.calendly_url || fb.calendlyUrl || '',
      website: cfg.website || fb.website || '',
      pricingModel: cfg.pricing_model || fb.pricingModel || '',
      services: Array.isArray(cfg.services) && cfg.services.length ? cfg.services : (fb.services || []),
      warmCallNotes: Array.isArray(cfg.warm_call_notes) && cfg.warm_call_notes.length ? cfg.warm_call_notes : (fb.warmCallNotes || []),
    };
  }

  return fallback;
}

export function isRetainerClient(deal){
  if(!deal) return false;
  const mc = findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  if(!mc) return false;
  const info = lookupClientInfo(mc.name);
  return info && info.pricingModel === 'Retainer';
}

export function getWarmCallQA(clientName){
  const info=lookupClientInfo(clientName);
  if(!info) return [];
  const qa=[];
  qa.push({q:'Where are you guys located?',a:'We\'re based out of '+(info.location||'the area')+'.'});
  qa.push({q:'What areas do you service?',a:'We service '+(info.serviceAreaCities||'the surrounding area')+'.'});
  qa.push({q:'What services do you offer?',a:(info.services||[]).join(', ')||'We offer a full range of services — happy to go over the details on a call.'});
  qa.push({q:'Can I get a quote?',a:'Absolutely! We can schedule a quick call to go over your property and get you a quote. What day works best for you?'});
  qa.push({q:'Do you do residential or commercial?',a:'We specialize in commercial properties — HOAs, apartment complexes, retail centers, office parks, and more.'});
  return qa;
}

export function findClientForDeal(deal){
  if(deal.pipeline==='Client' && deal.stage){
    const stageClient=state.clients.find(c=>c.name===deal.stage);
    if(stageClient) return stageClient;
  }
  const cn=str(deal.campaignName).toLowerCase();
  if(!cn) return null;
  for(const c of state.clients){
    const keywords=(str(c.campaignKeywords)+','+str(c.campaignName)).toLowerCase().split(',').map(k=>k.trim()).filter(k=>k);
    for(const kw of keywords){
      if(cn.includes(kw)) return c;
    }
  }
  return null;
}

export function buildServiceAreaUrl(mapUrl, address){
  if(!mapUrl || !address) return mapUrl||'';
  try {
    const u = new URL(mapUrl);
    if(u.hostname.includes('google.com/maps')){
      return 'https://www.google.com/maps/search/' + encodeURIComponent(address);
    }
    u.searchParams.set('q', address);
    return u.toString();
  } catch(e){
    return mapUrl;
  }
}

export async function addClient(name, extra={}){
  const c={
    id:uid(),name,
    color:CLIENT_PALETTE[state.clients.length%CLIENT_PALETTE.length],
    calendlyUrl:extra.calendlyUrl||'',
    campaignKeywords:extra.campaignKeywords||'',
    contactFirstName:extra.contactFirstName||'',
    notifyEmails:extra.notifyEmails||'',
    serviceAreaUrl:extra.serviceAreaUrl||'',
    enableForward:extra.notifyEmails?'TRUE':'FALSE',
    enableCalendly:extra.calendlyUrl?'TRUE':'FALSE',
    enableCopyInfo:'FALSE',
    enableTracker:'FALSE',
    leadCost:''
  };
  store.addClient(c);
  pendingWrites.value++;
  try {
    const resp = await sbCreateClient(camelToSnake(c));
    if(resp && resp.id) c.id = resp.id;
  } finally {
    pendingWrites.value--;
  }
}

export function removeClient(name){
  const client = state.clients.find(c => c.name === name);
  if(client && client.id){
    deletedClientIds.add(String(client.id));
    pendingWrites.value++;
    sbDeleteClient(client.id).catch(e=>console.error('Delete client failed:',e)).finally(() => { pendingWrites.value--; });
  }
  store.removeClient(name);
}

// ─── Client Info Panel (opened from column header click) ───
export function openClientInfoPanel(clientName){
  const cl=state.clients.find(c=>c.name===clientName);
  if(!cl) return;
  const info=lookupClientInfo(clientName)||{};
  const warmNotes=(info.warmCallNotes||[]);
  const sheetWarmNotes=str(cl.warmCallNotesText).trim();
  const warmLines=sheetWarmNotes?sheetWarmNotes.split('\n').filter(Boolean):warmNotes;
  const svcs=info.services||[];
  const qa=getWarmCallQA(clientName);

  const now=new Date();
  const todayStr=getToday();
  const oneWeekAgo=new Date(now.getTime()-7*24*60*60*1000);
  const scheduled=state.deals.filter(d=>{
    if(!isValidDate(d.bookedDate)) return false;
    const dt=new Date(d.bookedDate+'T'+(d.bookedTime||'23:59'));
    return dt>oneWeekAgo && d.stage===clientName;
  }).sort((a,b)=>{
    const da=new Date(a.bookedDate+'T'+(a.bookedTime||'00:00'));
    const db=new Date(b.bookedDate+'T'+(b.bookedTime||'00:00'));
    return da-db;
  });
  const appts=(state.appointments||[]).filter(a=>a.clientName===clientName&&a.apptDate>=todayStr)
    .sort((a,b)=>(a.apptDate+(a.apptTime||'')).localeCompare(b.apptDate+(b.apptTime||'')));

  let h=`<div id="client-info-overlay" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)this.remove()">
    <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:fadeIn .15s ease" onclick="event.stopPropagation()">
      <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:18px;color:#1e293b">${esc(clientName)}</h2>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${info.location?esc(info.location):''}${info.timeZone?' ('+esc(info.timeZone)+')':''}</div>
        </div>
        <button onclick="this.closest('#client-info-overlay').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div style="padding:20px 24px;max-height:70vh;overflow-y:auto">`;

  if(info.primaryContact||info.primaryEmail||info.phone){
    h+=`<div style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Contact</div>`;
    if(info.primaryContact) h+=`<div style="font-size:13px;color:#1e293b;margin-bottom:4px">${esc(info.primaryContact)}</div>`;
    if(info.primaryEmail) h+=`<div style="font-size:13px;color:#1e293b;margin-bottom:4px"><a href="mailto:${esc(info.primaryEmail)}" style="color:#2563eb">${esc(info.primaryEmail)}</a></div>`;
    if(info.phone) h+=`<div style="font-size:13px;color:#1e293b"><a href="tel:${esc(info.phone)}" style="color:#2563eb">${esc(info.phone)}</a></div>`;
    h+=`</div>`;
  }

  if(svcs.length){
    h+=`<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Services</div>
      <div style="font-size:13px;color:#334155;line-height:1.6">${svcs.map(s=>'• '+esc(s)).join('<br>')}</div>
    </div>`;
  }

  if(warmLines.length){
    h+=`<div style="margin-bottom:16px;padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
      <div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">SDR Quick Reference / Warm Call Notes</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#334155;line-height:1.7">
        ${warmLines.map(n=>'<li>'+esc(n)+'</li>').join('')}
      </ul>
    </div>`;
  }

  if(qa.length){
    h+=`<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Common Questions</div>`;
    for(const item of qa){
      h+=`<div style="margin-bottom:8px;padding:8px 10px;background:#fefce8;border-radius:6px;border:1px solid #fde68a">
        <div style="font-size:12px;font-weight:600;color:#92400e">${esc(item.q)}</div>
        <div style="font-size:12px;color:#78350f;margin-top:3px">${esc(item.a)}</div>
      </div>`;
    }
    h+=`</div>`;
  }

  if(cl.calendlyUrl){
    h+=`<div style="margin-bottom:16px">
      <button class="btn btn-primary" style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#818cf8;border-color:#818cf8"
        onclick="this.closest('#client-info-overlay').remove();openCalendlyEmbed(null,atob('${btoa(unescape(encodeURIComponent(cl.calendlyUrl)))}'),atob('${btoa(unescape(encodeURIComponent(clientName)))}'))">
        ${svgIcon('calendar',14)} Open ${esc(clientName)}'s Calendly
      </button>
    </div>`;
  }

  if(scheduled.length||appts.length){
    h+=`<div style="margin-bottom:16px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:8px">${svgIcon('calendar',12)} Scheduled Meetings (${scheduled.length+appts.length})</div>`;
    for(const m of scheduled){
      const d=new Date(m.bookedDate+'T'+(m.bookedTime||'00:00'));
      const isPast=d<now;
      const dateStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr=m.bookedTime?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
      h+=`<div style="font-size:12px;color:${isPast?'#9ca3af':'#78350f'};padding:3px 0;display:flex;justify-content:space-between">
        <span>${esc(m.company||m.contact||'Unknown')}${isPast?' <span style="font-size:9px">(past)</span>':''}</span>
        <span style="font-weight:600">${dateStr}${timeStr?' @ '+timeStr:''}</span>
      </div>`;
    }
    for(const a of appts){
      const d=new Date(a.apptDate+'T'+(a.apptTime||'00:00'));
      const dateStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr=a.apptTime?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
      h+=`<div style="font-size:12px;color:#78350f;padding:3px 0;display:flex;justify-content:space-between">
        <span>${esc(a.leadName||'Unknown')}</span>
        <span style="font-weight:600">${dateStr}${timeStr?' @ '+timeStr:''}</span>
      </div>`;
    }
    h+=`</div>`;
  }

  if(info.pricingModel){
    h+=`<div style="margin-bottom:16px;font-size:12px;color:#64748b"><strong>Pricing:</strong> ${esc(info.pricingModel)}</div>`;
  }

  h+=`</div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',h);
}

// Expose to inline HTML handlers
window.findClientForDeal = findClientForDeal;
window.openClientInfoPanel = openClientInfoPanel;
window.removeClient = removeClient;
