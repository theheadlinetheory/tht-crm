// ═══════════════════════════════════════════════════════════
// CLIENT-PROPERTIES — the properties a client already services
// ═══════════════════════════════════════════════════════════
//
// Asked for 2026-10-15 (Aidan + Ioannis): when a caller is on a client lead, one
// button on the deal card opens the list of properties that client already
// services, so "we already look after X down the road" is a click away. MVP is
// name + address, the address linked to Google Maps, every piece copyable on
// its own (whole-modal text selection is glitchy mid-call).
//
// Stored as plain text on clients.managed_properties, one property per line,
// exactly as pasted: "Name<TAB>Address" (two columns straight out of a sheet),
// "Name | Address", or "Name, Address". Parsing happens at render, so whatever
// staff paste is never rewritten.
//
// The overlay is appended to <body>, NOT inside the deal modal, so a render()
// while it is open cannot wipe it.

import { state } from './app.js?v=20261028024748';
import { esc, escAttr, str } from './utils.js?v=20261028024748';
import { isAdmin, isEmployee } from './auth.js?v=20261028024748';
import { sbUpdateClient } from './api.js?v=20261028024748';
import { registerActions } from './delegate.js?v=20261028024748';
import { findClientForDeal } from './client-info.js?v=20261028024748';

const OVERLAY_ID = 'client-props-overlay';
const HEADER_RE = /^(?!.*\d)(?=.*\b(property|name|site|building)\b)(?=.*\b(address|street|city)\b)/i;

let _clientId = null;

// ─── Parse ───
export function parseProperties(text) {
  const out = [];
  str(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (i === 0 && HEADER_RE.test(line)) return;     // pasted sheet header row
    let name = '', address = '';
    if (line.includes('\t')) {
      // Sheets paste: first column is the name, the rest (street, city, state,
      // zip in separate columns) is the address.
      const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
      name = cols.shift() || '';
      address = cols.join(', ').replace(/, (\d{5}(-\d{4})?)$/, ' $1');   // "FL, 32801" → "FL 32801"
      // First column is really a street ("123 Main St<TAB>Orlando FL"). Sheet pastes only:
      // a typed "7 Brew Coffee | Houston" is a name.
      if (/^\d+\s+\S/.test(name) && address && !/^\d/.test(address)) { address = name + ', ' + address; name = ''; }
    } else if (line.includes(' | ')) {
      const [a, ...b] = line.split(' | ');
      name = a.trim(); address = b.join(' | ').trim();
    } else if (/^\d+\s/.test(line)) {
      address = line;                                // "123 Main St, Orlando, FL" — no name
    } else {
      const k = line.indexOf(',');
      if (k === -1) name = line;
      else { name = line.slice(0, k).trim(); address = line.slice(k + 1).trim(); }
    }
    out.push({ name, address });
  });
  return out;
}

function mapsUrl(p, client) {
  // A name-only row still gets a link: search the name near the client's home base.
  const q = p.address ? (p.name ? p.name + ', ' + p.address : p.address)
                      : [p.name, str(client.location).trim()].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// "1310 26th St, Sacramento, CA 95816" -> "Sacramento". Falls back to the text as
// given when there is no state part ("Houston-area locations", "Upper West Side").
export function areaOf(address) {
  const parts = str(address).split(',').map(x => x.trim()).filter(Boolean);
  const st = parts.findIndex(x => /^[A-Z]{2}(\s+[A-Z0-9]{3}\s?[A-Z0-9]{3}|\s+\d{5}(-\d{4})?)?$/.test(x));
  if (st > 0) return parts[st - 1].replace(/\s*\(.*\)$/, '');
  if (parts.length > 1 && /^\d/.test(parts[0])) return parts.slice(1).join(', ');
  return /^\d+\s/.test(str(address)) ? '' : str(address).trim();
}

export function propertyCount(client) {
  return client ? parseProperties(client.managedProperties).length : 0;
}

// ─── Deal-card button ───
// Staff only — callers use it; a client user is looking at their own leads.
export function renderClientPropertiesButton(deal) {
  if (!(isAdmin() || isEmployee())) return '';
  const client = findClientForDeal(deal);
  if (!client) return '';
  const n = propertyCount(client);
  const style = n
    ? 'background:#0f766e;color:#fff;border-color:#0f766e'
    : 'background:#f9fafb;color:#6b7280;border-color:#d1d5db';
  return '<div class="form-group form-span2" style="margin-top:0">'
    // Inline onclick, not data-action: the deal modal's .modal stops propagation, so a
    // click inside it never reaches delegate.js's body listener (the button did nothing).
    + '<button onclick="openClientProperties(\'' + escAttr(str(client.id)) + '\');event.stopPropagation()" class="imessage-btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;' + style + '">'
    + '🏢 ' + esc(client.name) + '\'s Properties' + (n ? ' (' + n + ')' : ' — none on file') + '</button></div>';
}

// ─── Overlay ───
function copyBtn(text) {
  return '<button data-action="cpropsCopy" data-text="' + escAttr(text) + '" title="Copy" style="flex-shrink:0;padding:2px 8px;border-radius:5px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-size:10px;font-weight:600">Copy</button>';
}

function rowsHtml(client, filter) {
  const props = parseProperties(client.managedProperties);
  if (!props.length) {
    return '<div style="padding:24px 0;text-align:center;color:#94a3b8;font-size:13px;font-style:italic">No properties on file for ' + esc(client.name) + ' yet.</div>';
  }
  const f = str(filter).trim().toLowerCase();
  const shown = f ? props.filter(p => (p.name + ' ' + p.address).toLowerCase().includes(f)) : props;
  if (!shown.length) return '<div style="padding:16px 0;color:#94a3b8;font-size:12px">No match for “' + esc(filter) + '”.</div>';
  // Callers say "the Hilton off Harvard St in Sacramento", never "2200 Harvard St":
  // the name is the Maps link, only the area shows, the street stays in the link.
  return shown.map(p => {
    const label = p.name || areaOf(p.address) || 'Unnamed property';
    const area = p.name ? areaOf(p.address) : '';
    return '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;justify-content:space-between">'
      + '<div style="min-width:0">'
      + '<a href="' + escAttr(mapsUrl(p, client)) + '" target="_blank" rel="noopener" title="Open in Google Maps" style="font-size:13px;font-weight:600;color:#1d4ed8;text-decoration:none">📍 ' + esc(label) + '</a>'
      + (area ? '<div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(area) + '</div>' : '')
      + '</div>' + copyBtn(label) + '</div>';
  }).join('');
}

function currentClient() {
  return state.clients.find(c => str(c.id) === str(_clientId)) || null;
}

export function openClientProperties(clientId) {
  closeClientProperties();
  _clientId = clientId;
  const client = currentClient();
  if (!client) return;
  const n = propertyCount(client);
  const canEdit = isAdmin() || isEmployee();
  const h = `<div id="${OVERLAY_ID}" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)closeClientProperties()">
    <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:fadeIn .15s ease">
      <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-size:16px;font-weight:700;color:#1e293b">${esc(client.name)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Properties they currently service${n ? ' · ' + n : ''}</div>
        </div>
        <button data-action="cpropsClose" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div style="padding:12px 20px 16px">
        ${n > 6 ? `<input id="cprops-filter" data-action="cpropsFilter" placeholder="Filter by name, street or city…" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:var(--font);margin-bottom:4px">` : ''}
        <div id="cprops-list" style="max-height:55vh;overflow-y:auto">${rowsHtml(client, '')}</div>
        ${canEdit ? `<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
          <button data-action="cpropsEdit" style="background:none;border:none;padding:0;font-size:12px;color:#2563eb;cursor:pointer;font-weight:600">${n ? 'Edit list' : '+ Add properties'}</button>
          <span id="cprops-saved" style="font-size:11px;color:#16a34a;opacity:0;transition:opacity .2s">Saved</span>
        </div>
        <div id="cprops-edit" hidden style="margin-top:8px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">One property per line: <b>Name, Address</b> — or paste the name + address columns straight from a spreadsheet.</div>
          <textarea id="cprops-input" rows="8" placeholder="Lakeview Apartments, 1200 Lake Dr, Orlando, FL 32801&#10;Sunset Plaza | 55 Sunset Blvd, Winter Park, FL"
            style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:var(--font);resize:vertical">${esc(str(client.managedProperties))}</textarea>
          <button data-action="cpropsSave" style="margin-top:6px;padding:5px 14px;border:1px solid #0f766e;border-radius:6px;background:#0f766e;color:#fff;font-size:12px;cursor:pointer;font-weight:600">Save</button>
        </div>` : ''}
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', h);
}

export function closeClientProperties() {
  document.getElementById(OVERLAY_ID)?.remove();
  _clientId = null;
}

async function saveList() {
  const client = currentClient();
  const input = document.getElementById('cprops-input');
  if (!client || !input) return;
  const text = input.value.replace(/\n{3,}/g, '\n\n').trim();
  const prev = client.managedProperties;
  client.managedProperties = text;                 // optimistic — list + button read state
  try {
    await sbUpdateClient(client.id, { managed_properties: text });
  } catch (e) {
    client.managedProperties = prev;
    console.error('Client properties save failed:', e);   // sbCall already toasted
    return;
  }
  // Re-open to redraw header count, filter box and list in one go.
  openClientProperties(client.id);
  const tick = document.getElementById('cprops-saved');
  if (tick) { tick.style.opacity = '1'; setTimeout(() => { tick.style.opacity = '0'; }, 1400); }
  window.refreshModal?.();                         // deal-card button count
}

registerActions({
  cpropsClose() { closeClientProperties(); },
  cpropsCopy(el, e) {
    e?.stopPropagation();
    navigator.clipboard.writeText(el.dataset.text).then(() => {
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = 'Copy'; }, 1200);
    });
  },
  cpropsFilter(el) {
    const client = currentClient();
    const list = document.getElementById('cprops-list');
    if (client && list) list.innerHTML = rowsHtml(client, el.value);
  },
  cpropsEdit() {
    const box = document.getElementById('cprops-edit');
    if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) document.getElementById('cprops-input')?.focus();
  },
  cpropsSave() { saveList(); },
});

window.openClientProperties = openClientProperties;
window.closeClientProperties = closeClientProperties;
