// ═══════════════════════════════════════════════════════════
// CLIENT-INFO — Client data, thread IDs, lookup functions
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites, deletedClientIds } from './app.js?v=20260714c';
import { CLIENT_PALETTE } from './config.js?v=20260714c';
import { render } from './render.js?v=20260714c';
import { str, uid, esc, isValidDate, getToday, svgIcon } from './utils.js?v=20260714c';
import { sbCreateClient, sbDeleteClient, camelToSnake, supabase } from './api.js?v=20260714c';
import { isClient, isAdmin } from './auth.js?v=20260714c';

// ─── Derive campaign keyword from client name ───
const SKIP_PREFIXES = /^(the|a|an)\s+/i;
const STRIP_SUFFIXES = /[,.]?\s+(inc\.?|llc|corp\.?|co\.?|ltd\.?|company|services|landscaping|lawn\s+care|landscape|property\s+services|construction)\.?$/i;

function deriveKeyword(name) {
  let s = (name || '').trim();
  s = s.replace(STRIP_SUFFIXES, '');
  s = s.replace(SKIP_PREFIXES, '');
  return (s.split(/\s/)[0] || name.split(/\s/)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Client lookup (single source of truth: state.clients) ───

function findClientByName(name){
  if(!name) return null;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g,'');
  return state.clients.find(c => { const cn=str(c.name).toLowerCase().replace(/[^a-z0-9]/g,''); return cn===n || cn.includes(n) || n.includes(cn); }) || null;
}

export function getClientThreadId(name){ return findClientByName(name)?.gmailThreadId || ''; }
export const CLIENT_THREAD_IDS = new Proxy({}, { get: (_, p) => typeof p==='string' ? getClientThreadId(p) : undefined });

export function lookupClientInfo(name){
  const c = findClientByName(name);
  if(!c) return null;
  return {
    primaryContact: [str(c.contactFirstName).trim(), str(c.contactLastName).trim()].filter(Boolean).join(' '),
    primaryEmail: str(c.notifyEmail).trim(),
    phone: str(c.clientPhone).trim(),
    location: str(c.location).trim(),
    timeZone: str(c.timeZone).trim(),
    serviceAreaCities: str(c.serviceAreaCities).trim(),
    forwardName: str(c.forwardName).trim(),
    forwardEmail: str(c.notifyEmail).trim(),
    calendlyUrl: str(c.calendlyUrl).trim(),
    website: str(c.website).trim(),
    services: Array.isArray(c.services) ? c.services : [],
    billingModel: str(c.billingModel || 'per_lead'),
    warmCallNotes: [],
  };
}

export function isRetainerClient(deal){
  if(!deal) return false;
  const mc = findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);
  return !!mc && str(mc.billingModel) === 'retainer';
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
    campaignName:extra.campaignName||deriveKeyword(name),
    campaignKeywords:extra.campaignKeywords||deriveKeyword(name),
    contactFirstName:extra.contactFirstName||'',
    notifyEmails:extra.notifyEmails||'',
    serviceAreaUrl:extra.serviceAreaUrl||'',
    enableForward:extra.notifyEmails?'TRUE':'FALSE',
    enableCalendly:extra.calendlyUrl?'TRUE':'FALSE',
    enableCopyInfo:'FALSE',
    enableTracker:'TRUE',
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
    client.status = 'inactive';
    pendingWrites.value++;
    supabase.from('clients').update({ status: 'inactive' }).eq('id', client.id)
      .then(({ error }) => { if(error) console.error('Deactivate client failed:', error); })
      .finally(() => { pendingWrites.value--; });
  }
  render();
}

// ─── Timezone Derivation ───
export function deriveTimezone(location) {
  const l = (location || '').toUpperCase();
  const eastern = /\b(NY|NJ|CT|MA|PA|FL|GA|NC|SC|VA|MD|DE|ME|NH|VT|RI|OH|MI|IN|WV|DC)\b/;
  const central = /\b(TX|IL|MN|WI|MO|LA|AR|MS|AL|TN|KY|IA|KS|NE|ND|SD|OK)\b/;
  const mountain = /\b(CO|AZ|NM|UT|MT|WY|ID)\b/;
  const pacific = /\b(CA|WA|OR|NV)\b/;
  if (eastern.test(l)) return 'EST';
  if (central.test(l)) return 'CST';
  if (mountain.test(l)) return 'MST';
  if (pacific.test(l)) return 'PST';
  const lo = l.toLowerCase();
  if (/\b(sydney|melbourne|brisbane|canberra|gold coast|hobart)\b/.test(lo)) return 'AEST';
  if (/\b(adelaide|darwin)\b/.test(lo)) return 'ACST';
  if (/\b(perth)\b/.test(lo)) return 'AWST';
  if (/\b(toronto|ottawa|montreal|quebec)\b/.test(lo)) return 'EST';
  if (/\b(winnipeg)\b/.test(lo)) return 'CST';
  if (/\b(calgary|edmonton)\b/.test(lo)) return 'MST';
  if (/\b(vancouver|victoria)\b/.test(lo)) return 'PST';
  if (/\b(london|manchester|birmingham|leeds|glasgow|bristol|liverpool|edinburgh)\b/.test(lo)) return 'GMT';
  if (/\b(auckland|wellington|christchurch)\b/.test(lo)) return 'NZST';
  return '';
}

// ─── Create Client Record (structured, no side-effects) ───
// Single clients-row create used by the Won modal. No GHL / dropdown /
// Client Info sheet / SmartLead writes — the modal orchestrates those.
// Returns the client object with its server id.
export async function createClientRecord(fields) {
  const c = {
    id: uid(),
    color: CLIENT_PALETTE[state.clients.length % CLIENT_PALETTE.length],
    calendlyUrl: '',
    serviceAreaUrl: '',
    enableAutoForward: 'FALSE',
    enableCalendly: 'FALSE',
    enableCopyInfo: 'FALSE',
    enableTracker: 'TRUE',
    ...fields,
  };
  if (!c.enableForward) c.enableForward = c.notifyEmail ? 'TRUE' : 'FALSE';
  if (!c.campaignName) c.campaignName = deriveKeyword(c.name);
  if (!c.campaignKeywords) c.campaignKeywords = deriveKeyword(c.name);
  store.addClient(c);
  pendingWrites.value++;
  try {
    const resp = await sbCreateClient(camelToSnake(c));
    if (resp && resp.id) c.id = resp.id;
  } finally {
    pendingWrites.value--;
  }
  return c;
}

window.createClientRecord = createClientRecord;

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

  if(info.serviceAreaCities || str(cl.serviceAreaUrl).trim()){
    h+=`<div style="margin-bottom:16px;padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
      <div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Service Area</div>
      ${info.serviceAreaCities?`<div style="font-size:13px;color:#1e3a5f;line-height:1.6;margin-bottom:${str(cl.serviceAreaUrl).trim()?'8':'0'}px">${esc(info.serviceAreaCities)}</div>`:''}
      ${str(cl.serviceAreaUrl).trim()?`<a href="${esc(str(cl.serviceAreaUrl))}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#2563eb;text-decoration:none;font-weight:600">Open Service Area Map ↗</a>`:''}
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

  if(info.billingModel && isAdmin()){
    h+=`<div style="margin-bottom:16px;font-size:12px;color:#64748b"><strong>Billing:</strong> ${esc(info.billingModel)}</div>`;
  }

  h+=`</div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',h);
}

// Expose to inline HTML handlers
window.findClientForDeal = findClientForDeal;
window.openClientInfoPanel = openClientInfoPanel;
window.removeClient = removeClient;
