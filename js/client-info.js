// ═══════════════════════════════════════════════════════════
// CLIENT-INFO — Client data, thread IDs, lookup functions
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites } from './app.js?v=20260908133932';
import { CLIENT_PALETTE } from './config.js?v=20260908133932';
import { str, uid } from './utils.js?v=20260908133932';
import { sbCreateClient, camelToSnake } from './api.js?v=20260908133932';
import { answeredQuestions } from './client-acquisition.js?v=20260908133932';

// ─── Derive campaign keyword from client name ───
const SKIP_PREFIXES = /^(the|a|an)\s+/i;
const STRIP_SUFFIXES = /[,.]?\s+(inc\.?|llc|corp\.?|co\.?|ltd\.?|company|services|landscaping|lawn\s+care|landscape|property\s+services|construction)\.?$/i;

function deriveKeyword(name) {
  let s = (name || '').trim();
  s = s.replace(STRIP_SUFFIXES, '');
  s = s.replace(SKIP_PREFIXES, '');
  // Keep internal punctuation, trim only edge punctuation, so the keyword stays a
  // faithful substring of the campaign name. "Woody's" → "woody's" (a substring of
  // "woody's landcare…"), NOT "woodys" (matches nothing). Stripping punctuation out
  // entirely broke apostrophe/ampersand names; truncating at it over-shortens
  // ("O'Brien" → "o", which matches everything).
  return (s.split(/\s/)[0] || name.split(/\s/)[0] || '').toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
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
  const c=findClientByName(clientName);
  if(!c) return [];
  return answeredQuestions(c).filter(q=>q.answered).map(q=>({q:q.q,a:q.a}));
}

// A keyword only counts when it lands on a word boundary. A bare `includes` let
// GM Landscaping's 2-char keyword "gm" match INSIDE "non GMaps", so every lead
// from "Timesavers … non GMaps Housing leads Tampa FL" and "LawnValue … non
// GMaps Leads Nashville TN" auto-assigned to GM Landscaping.
function keywordHitsCampaign(campaign, kw){
  let i=campaign.indexOf(kw);
  while(i!==-1){
    const before=i>0?campaign[i-1]:' ';
    const after=campaign[i+kw.length]||' ';
    if(!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    i=campaign.indexOf(kw,i+1);
  }
  return false;
}

export function findClientForDeal(deal){
  if(deal.pipeline==='Client' && deal.stage){
    const stageClient=state.clients.find(c=>c.name===deal.stage);
    if(stageClient) return stageClient;
  }
  const cn=str(deal.campaignName).toLowerCase();
  if(!cn) return null;
  // Longest matching keyword wins — NOT whichever client comes first. state.clients
  // is loaded with a plain select('*') and has no stable order, so first-match-wins
  // made an ambiguous campaign resolve to a different client run to run.
  let best=null, bestLen=0;
  for(const c of state.clients){
    const keywords=(str(c.campaignKeywords)+','+str(c.campaignName)).toLowerCase().split(',').map(k=>k.trim()).filter(k=>k);
    for(const kw of keywords){
      if(kw.length>bestLen && keywordHitsCampaign(cn,kw)){ best=c; bestLen=kw.length; }
    }
  }
  return best;
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

// Expose to inline HTML handlers
window.findClientForDeal = findClientForDeal;
