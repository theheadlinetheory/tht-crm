// ═══════════════════════════════════════════════════════════
// CLIENT-INFO — Client data, thread IDs, lookup functions
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites, deletedClientIds } from './app.js';
import { CLIENT_PALETTE } from './config.js';
import { render } from './render.js';
import { str, uid, esc, isValidDate, getToday, svgIcon } from './utils.js';
import { sbCreateClient, sbDeleteClient, camelToSnake } from './api.js';
import { isClient } from './auth.js';

// Gmail thread IDs for client lead delivery threads
export const _CLIENT_THREAD_MAP={
  'coastal':'QgrcJHsBnjKQcSZjMgCgFGkGXTTkftqvKqV',
  'high southern':'QgrcJHrjCsHKGnFzbJKfdBDqpjRkDqlFJLl',
  'time savers':'QgrcJHrtsHmskplJjWhGqMBqHgRhQRSMkxV',
  'rain':'KtbxLthZhjsnlCmbqkLBHffvDJfdDlrMKg',
  'lightning':'QgrcJHrhstfkKgsTsKkPRZVTfxTjlZftmtQ',
  'tropical':'QgrcJHsNjBzcHQKwFRZzmlcDJXpmDGzZrFV',
  'distinctive':'KtbxLrjGQDGShZsKKFBpSKqCMWQDpJksGV',
  'shade tree':'KtbxLzFzTZmwWnZrnGVFqVPrJNnMQQQwgV',
  'dallas land care':'KtbxLvhNTpfbgpCKHPMGZqQbDCgptrTSxq',
  'pioneer landscaping':'QgrcJHsBpWsHVxrmdXWrXJPbjGNZpjHwRvB',
  'pioneer':'QgrcJHsBpWsHVxrmdXWrXJPbjGNZpjHwRvB'
};

export function getClientThreadId(name){
  const n=(name||'').toLowerCase();
  const nStrip=n.replace(/\s+/g,'');
  for(const key of Object.keys(_CLIENT_THREAD_MAP)){
    const kStrip=key.replace(/\s+/g,'');
    if(n===key || nStrip===kStrip || n.includes(key) || key.includes(n)) return _CLIENT_THREAD_MAP[key];
  }
  return '';
}

export const CLIENT_THREAD_IDS=new Proxy({},{get:(_,prop)=>typeof prop==='string'?getClientThreadId(prop):undefined});

export const CLIENT_INFO={
  'High Southern':{
    primaryContact:'Will',primaryEmail:'will@highsouthernscapes.com',phone:'(704) 621-3215',
    location:'Charlotte, NC',timeZone:'EST',
    serviceAreaCities:'Charlotte (Dilworth, Eastover, Myers Park, SouthPark, Ballantyne), Matthews, Mint Hill, Pineville, Waxhaw, Weddington',
    forwardName:'Will',forwardEmail:'will@highsouthernscapes.com',
    calendlyUrl:'https://calendly.com/will-highsouthernscapes/30min',
    website:'https://www.highsouthernscapes.com/',
    pricingModel:'Pay-per-meeting',
    services:['Maintenance services (mowing, trimming, mulching, pine needle, lawn care, flower beds, irrigation)','Pesticide/chemical application','Installation services (retaining walls, outdoor patios, landscape installations)','General contracting']
  },
  'Time Savers':{
    primaryContact:'Joel',primaryEmail:'timesaverslandscaping@gmail.com',phone:'',
    location:'Brooksville, FL',timeZone:'EST',
    serviceAreaCities:'Pasco County, Pinellas County, Hillsborough County, Hernando County',
    forwardName:'Joel',forwardEmail:'timesaverslandscaping@gmail.com',
    calendlyUrl:'https://calendly.com/timesaverslandscaping/meeting-with-time-savers',
    website:'https://timesavers.services/',
    pricingModel:'Pay-per-meeting',
    services:['Weekly/year-round lawn maintenance (mowing, edging, trimming, blowing)','Full grounds maintenance (shrub trimming, weed control)','General property cleanups','Tree trimming, palm tree trimming','Mulch installation','Sod installation','Bush and tree installation','Irrigation services (monthly inspections, maintenance, repairs)','Storm debris cleanup','Gutter cleaning','Commercial services for HOAs, multifamily, retail, apartments'],
    warmCallNotes:['6 crew members (winter), up to 12 in summer, 3-4 trucks','Prefer: HOAs, multifamily, retail/shopping centers, apartments, property managers','One-stop-shop — proactive about fixing broken sprinklers, dry spots, etc. without being asked','Current clients: Marriott hotels, Holiday Inn, La Quinta, Days Inn, YMCA of the Suncoast, Church of Jesus Christ of Latter-day Saints (via CBRE), Invitation Homes, First Service Residential','Long-term commercial relationships, some clients for several years']
  },
  'Rain':{
    primaryContact:'Louis',primaryEmail:'Rainenviro@gmail.com',phone:'',
    location:'Gastonia, NC',timeZone:'EST',
    serviceAreaCities:'Gastonia, Charlotte, and surrounding areas (western NC/SC polygon — Greensboro to Myrtle Beach to Charleston to Greenville to Cherokee)',
    forwardName:'Louis',forwardEmail:'Rainenviro@gmail.com',
    website:'https://www.rainenvironmental.net/',
    pricingModel:'Pay-per-meeting',
    services:['Storm water management (SCM)','Retention pond compliance repairs','Annual inspections and maintenance','Fountains and aerations (HOAs)','Water quality management, algae treatment','Mowing','Neglected ponds / forestry mulching','Erosion control, silt fence, hydroseeding, forestry mulching'],
    warmCallNotes:['Compliance fines: $960–$3,200/month if pond not maintained — leverage this on calls','Annual SCM inspections included in monthly service at no extra cost','Proactive approach: minor repairs within budget get done automatically, no constant quoting','Fully licensed with confined space certifications for all SCM types (underground sand filters, wet ponds, dry ponds, bioretentions)','Minority-owned business (pending official certification)','Ideal clients: HOAs, industrial (2500+ sq ft footprint), property managers, Amazon warehouses, shopping centers','Current clients: Suncap (FL, complete pond redone), Redrock Mgmt / DR Horton (4 large ponds, multi-phase development)','25 different property managers in Lou\'s previous company fed him all their work because of this approach']
  },
  'Coastal':{
    primaryContact:'Ryan',primaryEmail:'ryan@coastallawncare.org',phone:'',
    location:'Pensacola, FL',timeZone:'CST',
    serviceAreaCities:'Pensacola, Cantonment, Bagdad, Milton, Gulf Breeze, Pace, Perdido Key',
    forwardName:'Ryan',forwardEmail:'ryan@coastallawncare.org',
    calendlyUrl:'https://calendly.com/ryan-coastallawncare/meeting-with-coastal-lawn-care',
    website:'https://www.coastallawncare.org/',
    pricingModel:'Pay-per-meeting',
    services:['Lawn care / routine maintenance (mowing)','Trimming','Edging','Mulching','Pine straw installation','Planting','Gutter clean-outs','Spring & fall yard cleanups','Commercial grounds maintenance (grass cutting + bush/hedge trimming)'],
    warmCallNotes:['White-glove, high-accountability commercial landscaping partner','Accountability + reliability: always answers the phone, does the job right every time','On-time, prompt service — clients never chase follow-ups or loose ends','Owner-operated in slower months + roster of 1099 subs to scale up as needed','Mostly autopay billing — low-friction, service just happens','Best fit: decision-makers who value professionalism and consistency over lowest-bid pricing','Case studies: Spinnaker Condominiums (Perdido Key), Data Perk/NOF Technologies (Pensacola)']
  },
  'Lightning':{
    primaryContact:'Jon',primaryEmail:'contact@lightninglawncare.co',phone:'(352) 352-1775',
    location:'Orlando & Ocala, FL (Marion, Orange, Seminole counties)',timeZone:'EST',
    serviceAreaCities:'Ocala, Orlando, Belleview, Dunnellon, Apopka, Winter Park, Sanford, Altamonte Springs, Lake Mary, Oviedo',
    forwardName:'Jon',forwardEmail:'contact@lightninglawncare.co',
    calendlyUrl:'https://calendly.com/jonrebel3/quote-meeting-with-lightning-lawn-care',
    website:'https://www.lightninglawncare.net/',
    pricingModel:'Pay-per-meeting',
    services:['Lawn mowing / routine maintenance (mowing, edging, detailing, blowing)','Hedge / shrub / ornamental trimming','Palm tree trimming','General property cleanups','Mulch replacement / installation','Rock & gravel installation','Sod installation (subcontracted)','Irrigation services (subcontracted)'],
    warmCallNotes:['Veteran-owned business','41 five-star reviews, no ratings below 5 stars','Speedy estimates + fast turnaround — often same-day from inquiry to estimate','Strong communication + reliability — clients always know when they\'re coming, never "disappears"','Does NOT do large tree removals requiring chainsaws/mats','Sod and irrigation are subcontracted']
  },
  'ABC':{
    primaryContact:'Joel',primaryEmail:'joelb.abclandscaping@gmail.com',phone:'(480) 680-8587',
    location:'Phoenix, AZ (Maricopa County)',timeZone:'MST',
    serviceAreaCities:'Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Glendale, Peoria, Surprise, Avondale, Goodyear, Fountain Hills, Paradise Valley, Cave Creek, Anthem',
    forwardName:'Joel',forwardEmail:'joelb.abclandscaping@gmail.com',
    website:'https://www.abclandscapingllc.com/',
    pricingModel:'Retainer',
    services:['Weekly commercial landscape maintenance (mowing, edging, trimming, blowing)','Bush / hedge trimming','Pre-emergent weed control','Irrigation repairs (valves, backflows, timers)','Tree trimming','Palm tree trimming','Landscape installations (plants, turf removal, granite rock, full installs)','Parking lot / hardscape blowing and detailing','All work performed in-house (no subcontractors)'],
    warmCallNotes:['8 crews (2-4 per crew) — large in-house operation, no subcontractors','Mid-market pricing with immaculate standards for higher-end properties (luxury apartments, medical plazas, HOAs)','One-stop shop for both maintenance and installs','All work performed in-house — no subcontractors','Exclusion: does not service Florence, AZ (too far southeast for routing)']
  },
  'Tropical':{
    primaryContact:'Greg',primaryEmail:'glewis1224@gmail.com',phone:'(561) 479-8283',
    location:'Palm Beach & Broward County, FL',timeZone:'EST',
    serviceAreaCities:'West Palm Beach, Boca Raton, Boynton Beach, Delray Beach, Jupiter, Palm Beach Gardens, Wellington, Fort Lauderdale, Coral Springs, Plantation, Pompano Beach, Coconut Creek',
    forwardName:'Greg',forwardEmail:'glewis1224@gmail.com',
    website:'https://tropicallandscapefl.com/',
    pricingModel:'Pay-per-meeting',
    services:['Commercial landscape maintenance','Landscape installation','Fertilization','Pest control','Tree trimming (subcontracted)','Irrigation work (subcontracted)','Seasonal flower installation (spring + fall)','Mulch installation'],
    warmCallNotes:['FREE flowers for the life of the contract — seasonal flower installations included at no cost (spring + fall)','10% discount for Christian churches','Proactive property walks with property managers (monthly or every other month)','High-touch, over-communicative — calls/texts property managers before or during service visits','One-stop coordination: irrigation and tree work managed through them even when subcontracted','Commercial-first mindset, especially business parks','Flowers strategically placed at monument signs, clubhouses, entrances — 200 for smaller properties, 500+ for larger sites']
  },
  'Distinctive':{
    primaryContact:'Jose',primaryEmail:'info.distinctiveland@gmail.com',phone:'(206) 602-9088',
    location:'Auburn, WA',timeZone:'PST',
    serviceAreaCities:'King County & Pierce County, WA — Auburn, Bellevue, Federal Way, Kent, Renton, Seattle, Tacoma, Puyallup, Lakewood, Gig Harbor',
    forwardName:'Jose',forwardEmail:'info.distinctiveland@gmail.com',
    calendlyUrl:'https://calendly.com/info-distinctiveland/30min',
    website:'https://distinctivelandscapingllc.com/',
    pricingModel:'Pay-per-meeting',
    services:['Commercial landscape maintenance','Lawn renovations','Reseeding / turf renovation','Mulch installation','Pressure washing','Wood fencing installation','Minor irrigation repairs'],
    warmCallNotes:['High attention to detail — treats properties as if they were their own','Emphasis on quality workmanship over volume','Willing to go above and beyond standard scope when needed']
  },
  'Deeter':{
    primaryContact:'Justin',primaryEmail:'info@deeterlandscape.com',phone:'',
    location:'Richboro, PA',timeZone:'EST',
    serviceAreaCities:'Bucks County, Montgomery County, Philadelphia, Delaware County, eastern Chester County — Bensalem, Doylestown, Lansdale, Newtown, Richboro, Warrington, Hatfield, King of Prussia, Conshohocken, Ardmore',
    forwardName:'Justin',forwardEmail:'info@deeterlandscape.com',
    website:'https://deeterlandscape.com/',
    pricingModel:'Retainer',
    services:['Commercial landscape maintenance (contract work)','Weekly grounds maintenance (mowing, edging, trimming, blowing)','Shrub and hedge trimming','Mulch installation','Seasonal flower installation','Lawn treatments','Landscape design','Hardscaping (patios, driveways, retaining walls)'],
    warmCallNotes:['Full-service contractor: maintenance, design, AND hardscape divisions','Proactive service — clients don\'t need to call about weeds or issues, they handle it','Contract-focused execution with consistent fulfillment','Understands commercial client priorities — landscaping isn\'t their main focus, so Deeter makes it hands-off','Does NOT service New Jersey or western Chester County']
  },
  'Dallas Land Care':{
    primaryContact:'Heath',primaryEmail:'heath@dallaslandcare.com',phone:'(972) 674-3105',
    location:'Preston Rd., Dallas, TX',timeZone:'CST',
    serviceAreaCities:'Dallas, Fort Worth, Arlington, Plano, Frisco, McKinney, Irving, Garland, Richardson, Carrollton, Lewisville, Denton, Allen, Flower Mound (full DFW metro)',
    forwardName:'Heath',forwardEmail:'heath@dallaslandcare.com',
    website:'https://www.dallaslandcare.com/',
    pricingModel:'Pay-per-meeting',
    services:['Commercial landscape maintenance','Lawn care (mowing, edging, trimming, blowing)','Porter services (trash pickup, trash can change-outs, property clean-up)','Power washing','Tree trimming and removal (subcontracted)','Irrigation repair and sprinkler installation','Artificial turf installation (subcontracted)'],
    warmCallNotes:['24 years in business','One-stop-shop for landscape maintenance AND porter services — can bundle both under one vendor','Serves entire DFW metro area (Dallas, Tarrant, Collin, Denton counties)','Broad service offering beyond basic maintenance (porter, power washing, artificial turf, irrigation)']
  },
  'Umbrella Space PS':{
    primaryContact:'Russ',primaryEmail:'russk@umbrellaps.com',phone:'',
    location:'Mokena, IL',timeZone:'CST',
    serviceAreaCities:'Chicagoland area',
    forwardName:'George',forwardEmail:'cs@umbrellaps.com',
    calendlyUrl:'https://calendly.com/cs-umbrellaps/meeting-with-umbrella-property-services',
    website:'https://www.umbrellaps.com/',
    pricingModel:'Pay-per-meeting',
    services:['Full-service landscape maintenance','Lawn mowing and routine grounds maintenance','Spring cleanups','Shrub and bush trimming','Tree trimming and tree work','Fertilization and weed control','Core aeration and overseeding','Snow removal','Outdoor living installation (pavers, decks, water features)','Facility maintenance (building maintenance services)']
  },
  'Pioneer Landscaping':{
    primaryContact:'JP',primaryEmail:'JP@pioneerlandscapingmn.com',phone:'',
    location:'Twin Cities, MN',timeZone:'CST',
    serviceAreaCities:'Anoka, Carver, Dakota, Hennepin, Ramsey, Scott, Washington, Chisago, Isanti (MN), Saint Croix, Pierce (WI)',
    forwardName:'JP',forwardEmail:'JP@pioneerlandscapingmn.com',
    calendlyUrl:'https://calendly.com/jp-pioneerlandscapingmn/meeting-with-pioneer-landscapaing',
    website:'https://www.pioneerlandscapingmn.com/',
    pricingModel:'Pay-per-meeting',
    services:[]
  },
  'Shade Tree':{
    primaryContact:'Alan',primaryEmail:'contact@shadetreelandscaping.ca',phone:'+1 (289) 891-0313',
    location:'Richmond Hill, ON',timeZone:'EST',
    serviceAreaCities:'Greater Toronto Area — Toronto, Brampton, Mississauga, Vaughan, Markham, Richmond Hill, Newmarket, Aurora, Oshawa, Pickering, Ajax, Whitby',
    forwardName:'Alan',forwardEmail:'contact@shadetreelandscaping.ca',
    website:'https://www.shadetreelandscaping.ca/',
    pricingModel:'Pay-per-meeting',
    services:['Commercial property maintenance / grounds maintenance','Lawn maintenance (mowing/trim work)','Fertilizer application','Spring and fall cleanup','Shrub/bush maintenance','Flower bed maintenance','Weed control','Tree trimming and removal','Snow plowing','Salting / de-icing'],
    warmCallNotes:['Good value: high-quality service for a fair price','Very responsive and fast communication','Also does snow plowing and salting/de-icing (seasonal)','Fertilizer 2x/year, spring + fall cleanups included','Does NOT service Halton Region']
  },
  'GM Landscaping & Design':{
    primaryContact:'',primaryEmail:'',phone:'',
    location:'Mayfield Heights, OH',timeZone:'EST',
    serviceAreaCities:'Geauga County, east Cuyahoga County, Lake County (OH) — approximately 20-25 miles from Mayfield Heights. Does NOT cover west side of Cleveland or downtown unless contract justifies it.',
    forwardName:'',forwardEmail:'',
    website:'',
    pricingModel:'',
    services:['Weekly lawn maintenance','Shrub/hedge trimming','Tree trimming/care','Mulch/bed maintenance','New plantings/installations','Seasonal cleanups','Fertilizing','Snow plowing','Salting/de-icing','Sidewalk snow clearing','Snow remediation','Tree removal (subcontracted)','Drainage installation','Brush clearing','Patio installation','Walkway installation','Retaining wall installation','Fence installation'],
    warmCallNotes:['Consistency — reliable, scheduled service you can count on','Strong communication with property managers','Quick issue resolution — problems get handled fast','One-stop-shop for landscaping, snow, and hardscaping','11 years in business','Does NOT cover west side of Cleveland or downtown unless the contract justifies it']
  },
  'Kay\'s Landscaping':{
    primaryContact:'',primaryEmail:'',phone:'',
    location:'Vancouver, BC',timeZone:'PST',
    serviceAreaCities:'Vancouver, Richmond, Surrey (including Cloverdale), Burnaby, Coquitlam, Port Coquitlam, New Westminster, Delta, North Vancouver, Langley. Does NOT cover West Vancouver, Abbotsford, Pitt Meadows, or Maple Ridge.',
    forwardName:'',forwardEmail:'',
    website:'',
    pricingModel:'',
    services:['Lawn maintenance (mowing, edging, trimming)','Hedge and shrub trimming','Bed cleanup and weed control','Fall/winter leaf and seasonal cleanups','Sod installation','Snow removal and ice management (24/7)','Salting and walkway clearing','Aerating and dethatching','Lawn repair treatments (seeding, fertilizing, liming)','Bark mulch, soil, hog fuel, and river rock delivery/installation','Green waste removal'],
    warmCallNotes:['Communication — clients value responsive, consistent communication','Consistency — reliable, dependable service delivery','8+ years in business','24/7 snow removal and ice management available','Does NOT cover West Vancouver, Abbotsford, Pitt Meadows, or Maple Ridge — Langley is eastern cutoff, Port Coquitlam is northeastern cutoff']
  }
};

// Look up CLIENT_INFO by name — handles full names, short names, partial matches
export function lookupClientInfo(name){
  if(!name) return null;
  const n=name.toLowerCase().trim();
  const nNoSpace=n.replace(/\s+/g,'');
  for(const key of Object.keys(CLIENT_INFO)){
    if(key.toLowerCase()===n) return CLIENT_INFO[key];
  }
  for(const key of Object.keys(CLIENT_INFO)){
    const k=key.toLowerCase();
    const kNoSpace=k.replace(/\s+/g,'');
    if(n.includes(k)||k.includes(n)||nNoSpace.includes(kNoSpace)||kNoSpace.includes(nNoSpace)) return CLIENT_INFO[key];
  }
  // Fallback: build info from synced client data
  const sc=state.clients.find(c=>{
    const cn=c.name.toLowerCase().trim();
    return cn===n||n.includes(cn)||cn.includes(n);
  });
  if(!sc) return null;
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
  return {
    timeZone:sc.timeZone||'',
    location:parsedLocation||str(sc.location).trim()||'',
    primaryContact:str(sc.contactFirstName).trim()||'',
    primaryEmail:str(sc.notifyEmail).trim()||'',
    forwardEmail:str(sc.notifyEmail).trim()||'',
    calendlyUrl:str(sc.calendlyUrl).trim()||'',
    website:str(sc.website).trim()||'',
    services:parsedServices.length?parsedServices:undefined,
    serviceAreaCities:parsedServiceArea||'',
    pricingModel:parsedPricing||'',
    warmCallNotes:[]
  };
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
  state.clients.push(c);render();
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
  state.clients = state.clients.filter(c => c.name !== name);
  render();
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
