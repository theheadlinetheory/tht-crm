// ═══════════════════════════════════════════════════════════
// MAPS — Service area maps, geocoding, polygon checks
// ═══════════════════════════════════════════════════════════
//
// NOTE: SERVICE_AREA_POLYGONS is extremely large inline data (~40KB).
// It remains in index.html until the final migration, when it will be
// moved to a separate data file (e.g., service_area_data.js).
// This module provides the functions that operate on that data.

import { state, pendingWrites } from './app.js?v=20260904120704';
import { GEOCODIO_KEY, CA_PROVINCES, CA_POSTAL, CA_CITIES, detectCountry, isInternationalAddress } from './config.js?v=20260904120704';
import { render, refreshModal } from './render.js?v=20260904120704';
import { str, esc } from './utils.js?v=20260904120704';
import { findClientForDeal, lookupClientInfo } from './client-info.js?v=20260904120704';

let SERVICE_AREA_POLYGONS = {};
let POLYGON_ALIASES = {};

export function setServiceAreaData(polygons, aliases){
  SERVICE_AREA_POLYGONS = polygons;
  POLYGON_ALIASES = aliases || {};
}

export const serviceAreaResults = {};
export let geocodeCache = {};
const activeMapInstances = {};

// ── Service-area geometry normalization ──────────────────────────────
// A service area is a dissolved union of counties/ZIPs/FSAs, so it routinely
// has holes — pockets inside the outer boundary that the client does NOT
// cover. Both KML importers (settings.js uploadKml and onboarding's
// push_service_area_to_crm.py) used to walk every <coordinates> element and
// make each one its own top-level part, which turns a hole into a solid
// island. Stored that way a hole paints as covered on the map AND reads as
// "inside" in the point check, so re-nest on read — that repairs every client
// already stored flat, and one repair feeds both the map and the check.
//
// Containment alone is NOT enough to call something a hole. Some areas are a
// pile of overlapping per-city shapes that were never dissolved (Hammer
// Excavations: 482 rings, 1421 overlapping pairs), where a small ring inside a
// big one is a legitimate member, not a pocket. What separates the two is
// winding order: a writer emits a hole wound opposite to its shell. So a ring
// is a hole only when its smallest container is an outer AND winds the other
// way — on Hammer that correctly infers zero holes instead of 428.
//
// Rings already nested by the source are trusted as-is; inference is only for
// the flattened ones.
const _polygonCache = new Map();

export function invalidateServiceAreaCache(clientName){
  if(clientName) _polygonCache.delete(clientName); else _polygonCache.clear();
}

function ringBBox(ring){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const c of ring){
    if(c[0]<x0)x0=c[0]; if(c[0]>x1)x1=c[0];
    if(c[1]<y0)y0=c[1]; if(c[1]>y1)y1=c[1];
  }
  return [x0,y0,x1,y1];
}

function ringArea(ring){
  let sum=0;
  for(let i=0;i<ring.length-1;i++){
    sum += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1];
  }
  return Math.abs(sum)/2;
}

function pointInRing(pt, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    if((yi>pt[1])!==(yj>pt[1]) && pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}

// Every vertex of a true hole lies inside its shell, so sample around the ring
// and require all of them — a ring that merely overlaps has vertices outside
// and gets rejected on the first one. One stray miss is forgiven so a hole that
// grazes the shell isn't lost to a sample landing on the boundary.
const CONTAINMENT_SAMPLES = 8;
function ringContainsRing(outer, outerBox, inner, innerBox){
  if(innerBox[0]<outerBox[0] || innerBox[1]<outerBox[1] ||
     innerBox[2]>outerBox[2] || innerBox[3]>outerBox[3]) return false;
  let misses=0;
  for(let s=0;s<CONTAINMENT_SAMPLES;s++){
    const pt=inner[Math.floor(inner.length*s/CONTAINMENT_SAMPLES)];
    if(!pointInRing(pt, outer) && ++misses>1) return false;
  }
  return true;
}

function closeRing(ring){
  const a=ring[0], b=ring[ring.length-1];
  return (a[0]===b[0] && a[1]===b[1]) ? ring : ring.concat([a]);
}

function isClockwise(ring){
  let sum=0;
  for(let i=0;i<ring.length-1;i++){
    sum += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1];
  }
  return sum < 0;
}

export function normalizeServiceAreaPolygon(feature){
  const geom = feature && feature.geometry;
  if(!geom) return feature;
  const parts = geom.type==='MultiPolygon' ? geom.coordinates
              : geom.type==='Polygon'      ? [geom.coordinates]
              : null;
  if(!parts) return feature;

  // Parts the source already nested keep their rings; only lone rings are
  // candidates for inference.
  const coordinates=[];
  const loose=[];
  for(const part of parts){
    const valid=(part||[]).filter(r=>r && r.length>=4).map(closeRing);
    if(!valid.length) continue;
    if(valid.length>1) coordinates.push(valid);
    else loose.push(valid[0]);
  }
  if(!coordinates.length && !loose.length) return feature;

  // Largest first: a container is always bigger than what it holds, so by the
  // time a ring is reached every possible container of it is already
  // classified — which is what lets an island inside a hole come back out as
  // covered rather than chaining into another hole.
  const boxes=loose.map(ringBBox);
  const areas=loose.map(ringArea);
  const cw=loose.map(isClockwise);
  const order=loose.map((_,i)=>i).sort((a,b)=>areas[b]-areas[a]);
  const slotOf=new Map();   // ring index -> its slot in `coordinates` (outers only)

  order.forEach((i,rank)=>{
    let container=-1, smallest=Infinity;
    for(let k=0;k<rank;k++){
      const j=order[k];
      if(!ringContainsRing(loose[j],boxes[j],loose[i],boxes[i])) continue;
      if(areas[j]<smallest){ smallest=areas[j]; container=j; }
    }
    const isHole = container>=0 && slotOf.has(container) && cw[i]!==cw[container];
    if(isHole) coordinates[slotOf.get(container)].push(loose[i]);
    else { slotOf.set(i, coordinates.length); coordinates.push([loose[i]]); }
  });

  return {
    type:'Feature',
    properties:(feature.properties||{}),
    geometry:{ type:'MultiPolygon', coordinates },
  };
}

export function saveGeocodeCache(){
  try { localStorage.setItem('tht_geocodeCache', JSON.stringify(geocodeCache)); } catch(e){}
}

// Load cache from localStorage
try { geocodeCache = JSON.parse(localStorage.getItem('tht_geocodeCache')||'{}'); } catch(e){}

export function findPolygonForClient(clientName){
  if(!clientName) return null;
  if(_polygonCache.has(clientName)) return _polygonCache.get(clientName);
  const found = resolvePolygonForClient(clientName);
  // Normalize once per client — re-nesting is O(rings^2) and the biggest areas
  // run to a few hundred rings, so don't redo it on every deal render.
  const result = found ? { key: found.key, polygon: normalizeServiceAreaPolygon(found.polygon) } : null;
  _polygonCache.set(clientName, result);
  return result;
}

function resolvePolygonForClient(clientName){
  const client = state.clients.find(c => c.name === clientName);
  if(client && client.serviceAreaPolygons){
    let p = client.serviceAreaPolygons;
    if(typeof p === 'string'){ try { p = JSON.parse(p); } catch(e){ p = null; } }
    if(p && (p.geometry || p.type)) return { key: clientName, polygon: p };
  }
  const cn=clientName.toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const [key, poly] of Object.entries(SERVICE_AREA_POLYGONS)){
    const kn=key.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(cn.includes(kn) || kn.includes(cn)) return { key, polygon: poly };
    const alias=POLYGON_ALIASES[kn];
    if(alias && (cn.includes(alias) || alias.includes(cn) || cn === alias)) return { key, polygon: poly };
    const cnFirst=cn.replace(/[^a-z]/g,'').slice(0,8);
    const knFirst=kn.replace(/[^a-z]/g,'').slice(0,8);
    if(cnFirst.length >= 5 && cnFirst === knFirst) return { key, polygon: poly };
  }
  return null;
}

export function checkPointInServiceArea(lat, lng, polygon){
  if(!polygon || !window.turf) return null;
  try {
    const point = turf.point([lng, lat]);
    if(polygon.geometry.type === 'MultiPolygon'){
      for(const coords of polygon.geometry.coordinates){
        const poly = turf.polygon(coords);
        if(turf.booleanPointInPolygon(point, poly)) return true;
      }
      return false;
    }
    return turf.booleanPointInPolygon(point, polygon);
  } catch(e){ console.warn('turf error:', e); return null; }
}

export function normalizeAddressForGeocode(addr){
  if(!addr) return '';
  let normalized = addr.trim();
  // Remove trailing country codes
  normalized = normalized.replace(/,?\s*(US|USA|United States|CA|Canada)\s*$/i, '');
  return normalized;
}

function makePinIcon(color){
  return L.divIcon({className:'',html:`<svg width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`,iconSize:[24,36],iconAnchor:[12,36]});
}

const SERVICE_AREA_STYLE={color:'#15803d',weight:2,fillColor:'#22c55e',fillOpacity:0.3};

function drawPolygonLayers(map, polygon){
  const layers=[];
  if(!polygon || !polygon.geometry) return layers;
  const parts=polygon.geometry.type==='MultiPolygon'
    ? polygon.geometry.coordinates
    : [polygon.geometry.coordinates];
  for(const part of parts){
    // One layer per part, rings kept nested — Leaflet punches the holes out
    // itself. Flattening them into separate layers paints every hole solid and
    // strokes the interior boundaries, which is what made a covered area
    // unreadable at zoom.
    const latlngs=part.map(ring=>ring.map(c=>[c[1],c[0]]));
    if(!latlngs.length) continue;
    layers.push(L.polygon(latlngs, SERVICE_AREA_STYLE).addTo(map));
  }
  return layers;
}

function enrichAddress(deal){
  let addr=normalizeAddressForGeocode(deal.address||deal.location||'');
  if(!addr) return '';
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  if(client){
    const hasGeoContext = /\b[A-Z]{2}\b/.test(addr) || /\b\d{5}\b/.test(addr);
    if(!hasGeoContext){
      const info=lookupClientInfo(client.name);
      if(info && info.location) addr = addr + ', ' + info.location;
    }
  }
  const ctry = detectCountry(deal);
  // Canada included: normalizeAddressForGeocode strips a trailing "Canada", and
  // without it back on, a Canadian address with no province/postal code falls
  // into the US bucket below — where Geocodio happily matches it to a US town
  // ("100 Queen St W, Toronto, ON" → Jonestown, PA).
  if(ctry.code !== 'US'){
    if(!addr.toLowerCase().includes(ctry.label.toLowerCase())) addr += ', ' + ctry.label;
  }
  return addr;
}

// Addresses a provider answered on but couldn't match. In-session only (not
// persisted) so runServiceAreaChecks — which fires on every data refresh —
// doesn't re-request the same dead address over and over.
const geocodeFailures = new Set();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Progressively looser forms of an address, most precise first. A unit/suite
// number routinely defeats an OSM geocoder ("21331 Gordon Way Unit 1120" misses,
// "21331 Gordon Way" hits), and a lead whose street simply isn't in OSM is still
// better off with a city-level pin than with none. Deliberately no postal-code
// fallback — Photon fuzzy-matches those badly (V6W 1J9 → Cape Breton, NS).
function geocodeVariants(addr){
  const out=[addr];
  const noUnit=addr
    .replace(/\b(unit|suite|ste|apt|apartment|floor|fl|bldg|building|rm|room)\s*#?\s*[\w-]+/gi,'')
    .replace(/#\s*[\w-]+/g,'')
    .replace(/\s*,\s*,/g,',').replace(/\s{2,}/g,' ').replace(/\s+,/g,',').trim();
  if(noUnit && noUnit !== addr) out.push(noUnit);
  const m=addr.match(/,\s*([^,]+?),\s*([A-Za-z]{2})\b/);
  if(m) out.push(m[1].trim()+', '+m[2]+(/\bcanada\b/i.test(addr)?', Canada':''));
  return out;
}

// Geocodio is US-only on our plan, so Canadian and international addresses need
// their own provider. Both of these are OSM-backed, keyless and CORS-enabled;
// Photon leads because Nominatim's usage policy caps us at 1 request/second.
// Returns {lat,lng} on a hit, null when a provider answered with no match, and
// undefined when both errored (transient — worth retrying on the next refresh).
async function geocodeOneViaOSM(addr){
  let answered = false;
  try {
    const resp = await fetch('https://photon.komoot.io/api/?limit=1&q='+encodeURIComponent(addr));
    if(resp.ok){
      answered = true;
      const data = await resp.json();
      const feat = data.features && data.features[0];
      const c = feat && feat.geometry && feat.geometry.coordinates;
      if(c && c.length === 2) return {lat:c[1], lng:c[0]};
    }
  } catch(e){ console.warn('Photon geocode error for', addr, e); }
  try {
    await sleep(1100);
    const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(addr));
    if(resp.ok){
      answered = true;
      const data = await resp.json();
      if(Array.isArray(data) && data.length) return {lat:parseFloat(data[0].lat), lng:parseFloat(data[0].lon)};
    }
  } catch(e){ console.warn('Nominatim geocode error for', addr, e); }
  return answered ? null : undefined;
}

async function geocodeViaOSM(addr){
  for(const variant of geocodeVariants(addr)){
    const loc = await geocodeOneViaOSM(variant);
    if(loc) return loc;
    if(loc === undefined) return undefined; // both providers errored — retry later
  }
  return null;
}

export async function batchGeocode(addresses){
  if(!addresses.length) return {};
  // Filter out already-cached
  const toGeocode = addresses.filter(a => !geocodeCache[a] && !geocodeFailures.has(a));
  if(!toGeocode.length) return geocodeCache;

  const usAddrs = [];
  const caAddrs = [];
  const intlAddrs = [];
  for(const addr of toGeocode){
    // Anchored to the end because enrichAddress appends ", Canada" — an
    // unanchored match would claim US street names ("13727 Camino Canada,
    // El Cajon, CA").
    if(CA_PROVINCES.test(addr) || CA_POSTAL.test(addr) || CA_CITIES.test(addr) || /,\s*canada\s*$/i.test(addr)){
      caAddrs.push(addr);
    } else if(isInternationalAddress(addr)){
      intlAddrs.push(addr);
    } else {
      usAddrs.push(addr);
    }
  }

  // Batch geocode US addresses via Geocodio
  if(usAddrs.length){
    try {
      const resp = await fetch('https://api.geocod.io/v1.7/geocode?api_key='+GEOCODIO_KEY, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(usAddrs)
      });
      const data = await resp.json();
      if(data.results){
        for(let i=0;i<data.results.length;i++){
          const r=data.results[i];
          if(r.response && r.response.results && r.response.results.length){
            const loc=r.response.results[0].location;
            geocodeCache[usAddrs[i]]={lat:loc.lat,lng:loc.lng};
          }
        }
      }
    } catch(e){ console.warn('Geocodio batch error:', e); }
  }

  // Geocode Canadian + international addresses via OSM. This used to go through
  // Google's Geocoding API, but billing lapsed on that Cloud project and every
  // request came back REQUEST_DENIED — which is why Canada leads had no pin.
  for(const addr of caAddrs.concat(intlAddrs)){
    const loc = await geocodeViaOSM(addr);
    if(loc) geocodeCache[addr]=loc;
    else if(loc === null) geocodeFailures.add(addr);
  }

  saveGeocodeCache();
  return geocodeCache;
}

export async function runServiceAreaChecks(){
  // Get all deals that have addresses (client + acquisition)
  const clientDeals=state.deals.filter(d=>(d.location||d.address));
  if(!clientDeals.length) return;

  const addresses=[];
  const addrMap={};
  for(const d of clientDeals){
    const addr=enrichAddress(d);
    if(!addr) continue;
    addrMap[d.id]=addr;
    if(!geocodeCache[addr]) addresses.push(addr);
  }

  if(addresses.length) await batchGeocode(addresses);

  // Check each deal against its client's service area polygon (if available)
  // Always store geocoded coords so maps render even without polygon data
  for(const d of clientDeals){
    const addr=addrMap[d.id];
    if(!addr) continue;
    const cached=geocodeCache[addr];
    if(!cached) continue;
    const client=findClientForDeal(d)||state.clients.find(c=>c.name===d.stage);
    const clientName=client?client.name:'';
    const pm=client?findPolygonForClient(clientName):null;
    const inArea=pm?checkPointInServiceArea(cached.lat, cached.lng, pm.polygon):undefined;
    serviceAreaResults[d.id]={inArea, lat:cached.lat, lng:cached.lng, clientName};
  }
}

export function renderServiceAreaMap(containerId, dealId, opts){
  // Renders a Leaflet map in the given container
  const result=serviceAreaResults[dealId] || {};
  let lat = result.lat || (opts && opts.lat);
  let lng = result.lng || (opts && opts.lng);
  const container=document.getElementById(containerId);
  if(!container) return;
  const clientName = result.clientName || (opts && opts.clientName) || '';
  const inArea = result.inArea !== undefined ? result.inArea : (opts && opts.inArea);
  const pm=findPolygonForClient(clientName);
  const polygon=pm?pm.polygon:null;
  const defaultZoom = (opts && opts.defaultZoom) || 10;
  const hasPin = lat && lng;

  // If no lat/lng but we have a polygon, use polygon center as fallback
  if(!hasPin && polygon && polygon.geometry){
    try {
      const coords = polygon.geometry.type==='MultiPolygon'
        ? polygon.geometry.coordinates.flat(2)
        : polygon.geometry.coordinates.flat(1);
      const sumLat = coords.reduce((s,c) => s+c[1], 0);
      const sumLng = coords.reduce((s,c) => s+c[0], 0);
      lat = sumLat / coords.length;
      lng = sumLng / coords.length;
    } catch(e){}
  }

  // Still no coordinates — nothing to render
  if(!lat || !lng) return;

  // Clean up any existing map on this container
  if(activeMapInstances[dealId]){
    try { activeMapInstances[dealId].remove(); } catch(e){}
    delete activeMapInstances[dealId];
  }
  const map=L.map(container,{zoomControl:true,attributionControl:false,scrollWheelZoom:true}).setView([lat,lng],defaultZoom);
  activeMapInstances[dealId]=map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);

  // Prevent modal scroll from intercepting map drag
  container.addEventListener('mousedown',function(e){ e.stopPropagation(); });
  container.addEventListener('wheel',function(e){ e.stopPropagation(); },{ passive:false });

  const polyLayers=drawPolygonLayers(map, polygon);

  if(hasPin){
    L.marker([lat,lng],{icon:makePinIcon(inArea===false?'#ef4444':'#22c55e')}).addTo(map);
  }

  // Build bounds group once — includes polygon + pin if present
  const boundsGroup = L.featureGroup(polyLayers);
  if(hasPin) boundsGroup.addLayer(L.marker([lat,lng]));
  if(polyLayers.length){
    try { map.fitBounds(boundsGroup.getBounds().pad(0.1)); } catch(e){}
  }

  const refit = () => {
    map.invalidateSize();
    if(polyLayers.length){
      try { map.fitBounds(boundsGroup.getBounds().pad(0.1)); } catch(_e){}
    } else if(hasPin) {
      map.setView([lat, lng], defaultZoom);
    }
  };
  setTimeout(refit, 200);
  setTimeout(refit, 500);
  setTimeout(refit, 1000);

  return map;
}

let enlargedMapState = null;

export function openEnlargedMap(dealId, clientName){
  // Full-screen map overlay
  enlargedMapState={dealId,clientName};
  const overlay=document.createElement('div');
  overlay.id='enlarged-map-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;flex-direction:column';
  overlay.innerHTML=`
    <div style="padding:12px 20px;background:#fff;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb">
      <div style="font-size:14px;font-weight:700">${esc(clientName)} Service Area</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="enlarged-map-search" placeholder="Search address..." style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:240px;font-family:var(--font)" onkeydown="if(event.key==='Enter')searchEnlargedMap()">
        <button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="searchEnlargedMap()">Check</button>
        <button onclick="closeEnlargedMap()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280">&times;</button>
      </div>
    </div>
    <div id="enlarged-map-container" style="flex:1"></div>
    <div id="enlarged-map-result" style="padding:8px 20px;background:#fff;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb"></div>`;
  document.body.appendChild(overlay);

  setTimeout(()=>{
    const container=document.getElementById('enlarged-map-container');
    if(!container) return;
    const result=serviceAreaResults[dealId];
    const lat=result?result.lat:39.8;
    const lng=result?result.lng:-98.5;
    const map=L.map(container).setView([lat,lng],result?10:4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
    const pm=findPolygonForClient(clientName);
    const polygon=pm?pm.polygon:null;
    drawPolygonLayers(map, polygon);
    if(result){
      L.marker([result.lat,result.lng],{icon:makePinIcon(result.inArea?'#22c55e':'#ef4444')}).addTo(map);
    }
    enlargedMapState.map=map;
    enlargedMapState.polygon=polygon;
  },100);
}

export async function searchEnlargedMap(){
  const input=document.getElementById('enlarged-map-search');
  const resultEl=document.getElementById('enlarged-map-result');
  if(!input||!enlargedMapState) return;
  const addr=input.value.trim();
  if(!addr){resultEl.textContent='Enter an address to check.';return;}
  resultEl.textContent='Geocoding...';
  await batchGeocode([addr]);
  const cached=geocodeCache[addr];
  if(!cached){resultEl.textContent='Could not geocode address.';return;}
  const {lat,lng}=cached;
  const inArea=checkPointInServiceArea(lat,lng,enlargedMapState.polygon);
  if(enlargedMapState.map){
    enlargedMapState.map.setView([lat,lng],12);
    L.marker([lat,lng],{icon:makePinIcon(inArea?'#22c55e':'#ef4444')}).addTo(enlargedMapState.map);
  }
  resultEl.innerHTML=inArea
    ? `<span style="color:#22c55e;font-weight:700">\u2713 Inside service area</span> \u2014 ${esc(addr)}`
    : `<span style="color:#ef4444;font-weight:700">\u2717 Outside service area</span> \u2014 ${esc(addr)}`;
}

export function closeEnlargedMap(){
  const overlay=document.getElementById('enlarged-map-overlay');
  if(overlay) overlay.remove();
  enlargedMapState=null;
}

let _saGeoDebounce = null;
export function onAddressFieldChange(dealId, newAddr){
  clearTimeout(_saGeoDebounce);
  _saGeoDebounce=setTimeout(()=>{
    geocodeAndCheckDeal(dealId);
  },1500);
}

export async function geocodeAndCheckDeal(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const addr=enrichAddress(deal);
  if(!addr) return;
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  const clientName=client?client.name:'';

  await batchGeocode([addr]);
  const cached=geocodeCache[addr];
  if(!cached) return;
  const pm=client?findPolygonForClient(clientName):null;
  const inArea=pm?checkPointInServiceArea(cached.lat, cached.lng, pm.polygon):undefined;
  serviceAreaResults[dealId]={inArea, lat:cached.lat, lng:cached.lng, clientName};
  updateServiceAreaMapInPlace(dealId);
}

export function updateServiceAreaMapInPlace(dealId){
  const container=document.getElementById('sa-map-'+dealId);
  if(!container) return;
  // Properly remove existing Leaflet map instance before re-creating
  if(activeMapInstances[dealId]){
    try { activeMapInstances[dealId].remove(); } catch(e){}
    delete activeMapInstances[dealId];
  }
  container.innerHTML='';
  renderServiceAreaMap('sa-map-'+dealId, dealId, {fitBounds:false});
}

// Expose to inline HTML handlers
window.openEnlargedMap = openEnlargedMap;
window.searchEnlargedMap = searchEnlargedMap;
window.closeEnlargedMap = closeEnlargedMap;
window.onAddressFieldChange = onAddressFieldChange;
