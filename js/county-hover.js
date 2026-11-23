// ═══════════════════════════════════════════════════════════
// COUNTY HOVER — hovering a service-area polygon names the county under the
// cursor and lists the ZIP codes of that county that lie inside the area.
// ═══════════════════════════════════════════════════════════
//
// The stored service area is one dissolved shape with no county or ZIP names,
// so they are worked out here against Census reference files in data/geo/
// (built by scripts/build-county-geo.py, loaded only for the states the area
// touches):
//   - coverage: share of a county's land inside the area, from a sample grid.
//     It reads as the whole county at >= WHOLE_COUNTY, or at >= NEAR_WHOLE when
//     every ZIP of the county is inside too (the area and the Census edge come
//     from different sources, so a fully covered county can sample ~80-94%).
//     Anything else says it is only part of the county, with the rough share.
//   - ZIPs: a ZIP counts when its Census internal point lies inside the area.
//     ZIPs straddling the area edge go by that point.
// US only: a Canadian area matches no state file and gets no hover.

const GEO_BASE = new URL('../data/geo/', import.meta.url);
const WHOLE_COUNTY = 0.95;   // area and county edges come from different sources, so 100% never happens
const NEAR_WHOLE = 0.80;
const EDGE_ONLY = 0.03;      // below this with no ZIP inside, the area just clips the county's edge
const GRID = 40;             // sample points per side of a county's bounding box

let _statesIndex = null;
const _stateFiles = new Map();
const _coverage = new WeakMap(); // normalized polygon -> Promise<county results>

function loadJson(name){
  return fetch(new URL(name, GEO_BASE)).then(r => { if(!r.ok) throw new Error(name + ' ' + r.status); return r.json(); });
}
function loadStatesIndex(){
  if(!_statesIndex) _statesIndex = loadJson('states.json').catch(e => { _statesIndex = null; throw e; });
  return _statesIndex;
}
function loadState(st){
  if(!_stateFiles.has(st)) _stateFiles.set(st, loadJson(st + '.json').catch(e => { _stateFiles.delete(st); throw e; }));
  return _stateFiles.get(st);
}

// ── geometry ([lng, lat] throughout) ─────────────────────────────────
function bboxOf(rings){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const ring of rings) for(const c of ring){
    if(c[0]<x0)x0=c[0]; if(c[0]>x1)x1=c[0];
    if(c[1]<y0)y0=c[1]; if(c[1]>y1)y1=c[1];
  }
  return [x0,y0,x1,y1];
}
const boxesOverlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const inBox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
function inRing(x, y, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    if((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
// parts: [{box, rings:[outer, ...holes]}]
function inParts(x, y, parts){
  for(const p of parts){
    if(!inBox(x, y, p.box) || !inRing(x, y, p.rings[0])) continue;
    let hole=false;
    for(let i=1;i<p.rings.length;i++) if(inRing(x, y, p.rings[i])){ hole=true; break; }
    if(!hole) return true;
  }
  return false;
}
function toParts(polys){
  return polys.filter(rings => rings.length && rings[0].length > 2).map(rings => ({ box: bboxOf([rings[0]]), rings }));
}
function areaParts(polygon){
  const g = polygon && polygon.geometry;
  if(!g) return [];
  return toParts(g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]);
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function computeCoverage(polygon){
  const area = areaParts(polygon);
  if(!area.length) return [];
  const areaBox = bboxOf(area.map(p => p.rings[0]));
  const index = await loadStatesIndex();
  const states = Object.keys(index).filter(st => boxesOverlap(index[st], areaBox));
  const files = await Promise.all(states.map(st => loadState(st).then(cs => [st, cs])));
  const out = [];
  for(const [st, counties] of files){
    for(const c of counties){
      if(!boxesOverlap(c.b, areaBox)) continue;
      const parts = toParts(c.g);
      const [x0,y0,x1,y1] = c.b;
      let inCounty=0, inBoth=0;
      for(let i=0;i<GRID;i++) for(let j=0;j<GRID;j++){
        const x = x0 + (x1-x0)*(i+0.5)/GRID, y = y0 + (y1-y0)*(j+0.5)/GRID;
        if(!inParts(x, y, parts)) continue;
        inCounty++;
        if(inParts(x, y, area)) inBoth++;
      }
      const zips = c.z.filter(z => inParts(z[2], z[1], area)).map(z => z[0]);
      const coverage = inCounty ? inBoth / inCounty : 0;
      if(!inBoth && !zips.length) continue;
      out.push({ name: c.n, state: st, coverage, zips, totalZips: c.z.length, parts, latlngs: c.g.map(rings => rings.map(r => r.map(p => [p[1], p[0]]))) });
      await tick();
    }
  }
  return out;
}

export function countyCoverage(polygon){
  if(!polygon) return Promise.resolve([]);
  if(!_coverage.has(polygon)){
    _coverage.set(polygon, computeCoverage(polygon).catch(e => {
      console.warn('County hover data failed to load:', e);
      _coverage.delete(polygon);
      return [];
    }));
  }
  return _coverage.get(polygon);
}

// ── hover box ────────────────────────────────────────────────────────
// Lives on <body>, not in the map pane, so a long ZIP list is not clipped by a
// small map (the client panel's map is 220px tall).
let _box = null;
function box(){
  if(_box && _box.isConnected) return _box;
  _box = document.createElement('div');
  _box.style.cssText = 'position:fixed;z-index:100001;pointer-events:none;display:none;max-width:340px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 6px 20px rgba(15,23,42,.18);padding:10px 12px;font-family:var(--font, system-ui, sans-serif);font-size:12px;color:#1e293b;line-height:1.45';
  document.body.appendChild(_box);
  return _box;
}
function hideBox(){ if(_box) _box.style.display = 'none'; }
function placeBox(ev){
  const b = box();
  const pad = 14, w = b.offsetWidth, h = b.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if(x + w > window.innerWidth - 8) x = Math.max(8, ev.clientX - pad - w);
  if(y + h > window.innerHeight - 8) y = Math.max(8, ev.clientY - pad - h);
  b.style.left = x + 'px';
  b.style.top = y + 'px';
}

const escHtml = s => String(s).replace(/[&<>"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));

export function countyLabel(c){
  if(c.coverage >= WHOLE_COUNTY || (c.coverage >= NEAR_WHOLE && c.zips.length && c.zips.length === c.totalZips)){
    return { whole: true, text: 'Whole county' };
  }
  if(!c.zips.length && c.coverage < EDGE_ONLY) return { whole: false, text: 'Only the edge of this county (no ZIP codes inside the area)' };
  const pct = `~${Math.max(1, Math.round(c.coverage * 100))}%`;
  if(!c.zips.length) return { whole: false, text: `Only part of this county (${pct}), no ZIP codes centred inside the area` };
  return { whole: false, text: `Only part of this county (${pct}), ${c.zips.length} of its ${c.totalZips} ZIP codes` };
}

function boxHtml(c, note){
  const lbl = countyLabel(c);
  const zipLine = c.zips.length
    ? `<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin:6px 0 2px">${lbl.whole ? 'ZIP codes' : 'Only these ZIP codes'} (${c.zips.length})</div>
       <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#334155;word-break:break-word">${c.zips.map(escHtml).join(', ')}</div>`
    : '';
  return `<div style="font-weight:700;font-size:13px">${escHtml(c.name)}, ${escHtml(c.state)}</div>
    <div style="font-weight:600;color:${lbl.whole ? '#15803d' : '#b45309'}">${escHtml(lbl.text)}</div>
    ${zipLine}
    <div style="margin-top:6px;font-size:10px;color:#94a3b8">${note || (c.zips.length ? 'Click to copy the ZIP codes' : '')}</div>`;
}

const HILITE = { color:'#1e3a8a', weight:2, dashArray:'5 4', fill:false, interactive:false };

// Wires hover + click onto the polygon layers drawn for `polygon` on `map`.
export function attachCountyHover(map, layers, polygon){
  if(!map || !layers.length || !polygon) return;
  const ready = countyCoverage(polygon);
  let counties = null, current = null, hilite = null, copied = null;
  ready.then(cs => { counties = cs; });

  const clearHilite = () => { if(hilite){ map.removeLayer(hilite); hilite = null; } };
  const countyAt = ll => counties && counties.find(c => inParts(ll.lng, ll.lat, c.parts)) || null;

  const onMove = e => {
    if(counties === null){
      const b = box();
      b.innerHTML = '<div style="color:#64748b">Loading county data…</div>';
      b.style.display = 'block';
      placeBox(e.originalEvent);
      return;
    }
    const c = countyAt(e.latlng);
    if(!c){ hideBox(); clearHilite(); current = null; return; }
    if(c !== current){
      current = c; copied = null;
      clearHilite();
      hilite = L.polygon(c.latlngs, HILITE).addTo(map);
    }
    const b = box();
    b.innerHTML = boxHtml(c, copied === c ? `Copied ${c.zips.length} ZIP codes` : '');
    b.style.display = 'block';
    placeBox(e.originalEvent);
  };
  const onOut = () => { hideBox(); clearHilite(); current = null; };
  const onClick = e => {
    const c = countyAt(e.latlng);
    if(!c || !c.zips.length || !navigator.clipboard) return;
    navigator.clipboard.writeText(c.zips.join(', ')).then(() => { copied = c; onMove(e); }).catch(() => {});
  };

  for(const l of layers){
    l.on('mousemove', onMove);
    l.on('mouseout', onOut);
    l.on('click', onClick);
    l.on('remove', onOut);
  }
  map.on('unload', onOut);
}
