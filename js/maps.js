// ═══════════════════════════════════════════════════════════
// MAPS — Service area maps, geocoding, polygon checks
// ═══════════════════════════════════════════════════════════
//
// NOTE: SERVICE_AREA_POLYGONS is extremely large inline data (~40KB).
// It remains in index.html until the final migration, when it will be
// moved to a separate data file (e.g., service_area_data.js).
// This module provides the functions that operate on that data.

import { state, pendingWrites } from './app.js';
import { GEOCODIO_KEY, CA_PROVINCES } from './config.js';
import { render, refreshModal } from './render.js';
// api.js imports removed — no direct API calls in this module
import { str, esc } from './utils.js';
import { findClientForDeal, lookupClientInfo } from './client-info.js';

// These will be populated from the inline data or external file
let SERVICE_AREA_POLYGONS = {};
let POLYGON_ALIASES = {};

export function setServiceAreaData(polygons, aliases){
  SERVICE_AREA_POLYGONS = polygons;
  POLYGON_ALIASES = aliases || {};
}

export const serviceAreaResults = {};
export let geocodeCache = {};
const activeMapInstances = {};

export function saveGeocodeCache(){
  try { localStorage.setItem('tht_geocodeCache', JSON.stringify(geocodeCache)); } catch(e){}
}

// Load cache from localStorage
try { geocodeCache = JSON.parse(localStorage.getItem('tht_geocodeCache')||'{}'); } catch(e){}

export function findPolygonForClient(clientName){
  if(!clientName) return null;
  const cn=clientName.toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const [key, poly] of Object.entries(SERVICE_AREA_POLYGONS)){
    const kn=key.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(cn.includes(kn) || kn.includes(cn)) return { key, polygon: poly };
    // Check aliases
    const alias=POLYGON_ALIASES[kn];
    if(alias && (cn.includes(alias) || alias.includes(cn) || cn === alias)) return { key, polygon: poly };
    // First-word match
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

export async function batchGeocode(addresses){
  if(!addresses.length) return {};
  // Filter out already-cached
  const toGeocode = addresses.filter(a => !geocodeCache[a]);
  if(!toGeocode.length) return geocodeCache;

  // Check for Canadian addresses
  const usAddrs = [];
  const caAddrs = [];
  for(const addr of toGeocode){
    if(CA_PROVINCES.test(addr)){
      caAddrs.push(addr);
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

  // Geocode Canadian addresses one-by-one via Nominatim
  for(const addr of caAddrs){
    try {
      const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(addr));
      const data = await resp.json();
      if(data && data.length){
        geocodeCache[addr]={lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)};
      }
    } catch(e){ console.warn('Nominatim error for', addr, e); }
  }

  saveGeocodeCache();
  return geocodeCache;
}

export async function runServiceAreaChecks(){
  // Get all deals that have addresses (client + acquisition)
  const clientDeals=state.deals.filter(d=>(d.location||d.address));
  if(!clientDeals.length) return;

  // Collect addresses to geocode
  const addresses=[];
  for(const d of clientDeals){
    const addr=normalizeAddressForGeocode(d.address||d.location||'');
    if(addr && !geocodeCache[addr]) addresses.push(addr);
  }

  if(addresses.length) await batchGeocode(addresses);

  // Check each deal against its client's service area polygon (if available)
  // Always store geocoded coords so maps render even without polygon data
  for(const d of clientDeals){
    const addr=normalizeAddressForGeocode(d.address||d.location||'');
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

  // Draw polygon — always green
  const polyLayers=[];
  if(polygon && polygon.geometry){
    const coords=polygon.geometry.type==='MultiPolygon'
      ? polygon.geometry.coordinates.flat(1)
      : polygon.geometry.coordinates;
    for(const ring of coords){
      const pl=L.polygon(ring.map(c=>[c[1],c[0]]),{color:'#22c55e',weight:2,fillColor:'#bbf7d0',fillOpacity:0.25}).addTo(map);
      polyLayers.push(pl);
    }
  }

  // Add location pin marker only if we have actual geocoded coords
  if(hasPin){
    const pinIcon=L.divIcon({className:'',html:'<svg width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="'+(inArea===false?'#ef4444':'#22c55e')+'"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>',iconSize:[24,36],iconAnchor:[12,36]});
    L.marker([lat,lng],{icon:pinIcon}).addTo(map);
  }

  // Fit bounds to show full polygon (+ marker if present)
  if(polyLayers.length){
    try {
      const group=L.featureGroup(polyLayers);
      if(hasPin) group.addLayer(L.marker([lat,lng]));
      map.fitBounds(group.getBounds().pad(0.1));
    } catch(e){}
  }

  // Fix tiles not loading when container isn't fully rendered yet
  setTimeout(()=>{ map.invalidateSize(); },200);
  setTimeout(()=>{ map.invalidateSize(); },500);
  setTimeout(()=>{ map.invalidateSize(); },1000);

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
    if(polygon && polygon.geometry){
      const coords=polygon.geometry.type==='MultiPolygon'
        ? polygon.geometry.coordinates.flat(1)
        : polygon.geometry.coordinates;
      for(const ring of coords){
        L.polygon(ring.map(c=>[c[1],c[0]]),{color:'#22c55e',weight:2,fillColor:'#bbf7d0',fillOpacity:0.25}).addTo(map);
      }
    }
    if(result){
      const pinIcon=L.divIcon({className:'',html:'<svg width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="'+(result.inArea?'#22c55e':'#ef4444')+'"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>',iconSize:[24,36],iconAnchor:[12,36]});
      L.marker([result.lat,result.lng],{icon:pinIcon}).addTo(map);
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
    const pinIcon=L.divIcon({className:'',html:'<svg width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="'+(inArea?'#22c55e':'#ef4444')+'"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>',iconSize:[24,36],iconAnchor:[12,36]});
    L.marker([lat,lng],{icon:pinIcon}).addTo(enlargedMapState.map);
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
  const addr=normalizeAddressForGeocode(deal.address||deal.location||'');
  if(!addr) return;
  await batchGeocode([addr]);
  const cached=geocodeCache[addr];
  if(!cached) return;
  // Always store geocoded coords so the map renders — even without a client/polygon match
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  const clientName=client?client.name:'';
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
