// ═══════════════════════════════════════════════════════════
// PD-ACTIONS — Power Dialer maps, modals, Calendly booking
// ═══════════════════════════════════════════════════════════
import { supabase, showToast } from './api.js?v=20260724010617';
import { ACQ_CALENDLY_URLS } from './config.js?v=20260724010617';
import { openCalendlyEmbed } from './calendly.js?v=20260724010617';

let _miniMap = null;
let _miniMapAddr = '';
let _miniMapCoords = null;
let _expandMap = null;

// ─── Map ───

export function initMiniMap() {
  const el = document.getElementById('pd-mini-map');
  if (!el) return;
  const addr = el.dataset.addr;
  if (!addr || addr === _miniMapAddr) return;
  _miniMapAddr = addr;
  if (_miniMap) { _miniMap.remove(); _miniMap = null; }
  _miniMapCoords = null;
  fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`)
    .then(r => r.json()).then(results => {
      if (!results.length || !document.getElementById('pd-mini-map')) return;
      const lat = parseFloat(results[0].lat), lng = parseFloat(results[0].lon);
      _miniMapCoords = { lat, lng };
      _miniMap = L.map('pd-mini-map', { zoomControl: false, attributionControl: false, scrollWheelZoom: true }).setView([lat, lng], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_miniMap);
      L.marker([lat, lng]).addTo(_miniMap);
      setTimeout(() => _miniMap?.invalidateSize(), 200);
    }).catch(() => {});
}

export function cleanupMaps() {
  _miniMapAddr = ''; _miniMapCoords = null;
  if (_miniMap) { _miniMap.remove(); _miniMap = null; }
  if (_expandMap) { _expandMap.remove(); _expandMap = null; }
}

window.closeExpandMap = () => {
  if (_expandMap) { _expandMap.remove(); _expandMap = null; }
  document.getElementById('pd-map-expand')?.remove();
};

window.pdExpandMap = () => {
  const el = document.getElementById('pd-mini-map');
  const addr = el?.dataset.addr;
  if (!addr) return;
  window.closeExpandMap();
  const div = document.createElement('div');
  div.id = 'pd-map-expand';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) window.closeExpandMap(); };
  div.innerHTML = `<div style="background:#fff;border-radius:12px;overflow:hidden;width:700px;height:500px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:flex;flex-direction:column" onclick="event.stopPropagation()">
    <div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;font-weight:600">${addr}</span>
      <button onclick="closeExpandMap()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&times;</button>
    </div>
    <div id="pd-expand-map-container" style="flex:1"></div>
  </div>`;
  document.body.appendChild(div);
  function renderExpanded(lat, lng) {
    _expandMap = L.map('pd-expand-map-container', { scrollWheelZoom: true }).setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_expandMap);
    L.marker([lat, lng]).addTo(_expandMap);
  }
  if (_miniMapCoords) {
    renderExpanded(_miniMapCoords.lat, _miniMapCoords.lng);
  } else {
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`)
      .then(r => r.json()).then(results => {
        if (!results.length || !document.getElementById('pd-expand-map-container')) return;
        renderExpanded(parseFloat(results[0].lat), parseFloat(results[0].lon));
      }).catch(() => {});
  }
};

// ─── Campaign Settings Modal ───

export function showCampaignSettings(id, campaigns, onSaved) {
  const campaign = campaigns?.find(c => c.id === id);
  if (!campaign) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = () => overlay.remove();
  const scriptVal = (campaign.script || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  overlay.innerHTML = `<div class="modal" style="width:560px" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>Campaign Settings</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button></div>
    <div class="modal-body">
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Campaign Name</label>
        <input id="pd-settings-name" type="text" value="${campaign.name.replace(/"/g, '&quot;')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Call Script</label>
        <textarea id="pd-settings-script" rows="10" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);line-height:1.6;resize:vertical">${scriptVal}</textarea>
        <p style="font-size:10px;color:var(--text-muted);margin-top:4px">Use {{NAME}}, {{COMPANY}}, {{ADDRESS}} for merge fields</p>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Status</label>
        <select id="pd-settings-status" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          <option value="active"${campaign.status==='active'?' selected':''}>Active</option>
          <option value="paused"${campaign.status==='paused'?' selected':''}>Paused</option>
          <option value="completed"${campaign.status==='completed'?' selected':''}>Completed</option>
        </select>
      </div>
    </div>
    <div class="modal-footer" style="justify-content:flex-end;gap:8px">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="pdSaveCampaignSettings('${id}')">Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  window.pdSaveCampaignSettings = async (saveId) => {
    const name = document.getElementById('pd-settings-name')?.value?.trim();
    const script = document.getElementById('pd-settings-script')?.value;
    const status = document.getElementById('pd-settings-status')?.value;
    if (!name) { showToast('Name is required', 'error'); return; }
    const updates = { name, script, status };
    const { error } = await supabase.from('dialer_campaigns').update(updates).eq('id', saveId);
    if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
    const c = campaigns?.find(c => c.id === saveId);
    if (c) { Object.assign(c, updates); }
    document.querySelector('.modal-overlay')?.remove();
    showToast('Campaign settings saved', 'success');
    onSaved();
  };
}

// ─── Script Editor Modal ───

export function showScriptEditor(activeCampaign, onSaved) {
  if (!activeCampaign) return;
  const existing = document.getElementById('pd-script-editor');
  if (existing) { existing.remove(); return; }
  const overlay = document.createElement('div');
  overlay.id = 'pd-script-editor';
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="modal" style="width:560px" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>Edit Call Script</h3><button class="modal-close" onclick="document.getElementById('pd-script-editor').remove()">×</button></div>
    <div class="modal-body">
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px">Use {name}, {company}, {address} for merge fields.</p>
      <textarea id="pd-script-edit-ta" style="width:100%;height:250px;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--font);line-height:1.6;resize:vertical;box-sizing:border-box">${activeCampaign.script || ''}</textarea>
    </div>
    <div class="modal-footer" style="justify-content:flex-end;gap:8px">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="document.getElementById('pd-script-editor').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="pdSaveScript()">Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  window.pdSaveScript = async () => {
    const ta = document.getElementById('pd-script-edit-ta');
    if (!ta) return;
    activeCampaign.script = ta.value;
    await supabase.from('dialer_campaigns').update({ script: ta.value }).eq('id', activeCampaign.id);
    document.getElementById('pd-script-editor')?.remove();
    onSaved();
  };
}

// ─── Calendly Booking ───

export function bookCall(type, queue, queueIndex) {
  const contact = queue[queueIndex]; if (!contact) return;
  const url = ACQ_CALENDLY_URLS[type]; if (!url) return;
  openCalendlyEmbed(null, url, null, contact.name, contact.email);
}

export function showStrategyPicker(queue, queueIndex) {
  const overlay = document.createElement('div');
  overlay.id = 'strategy-call-picker';
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="modal" style="width:320px" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>Who's booking the strategy call?</h3><button class="modal-close" onclick="document.getElementById('strategy-call-picker').remove()">×</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:13px;background:#7c3aed;border-color:#7c3aed" onclick="document.getElementById('strategy-call-picker').remove();pdBookCall('strategy')">Aidan</button>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:13px;background:#2563eb;border-color:#2563eb" onclick="document.getElementById('strategy-call-picker').remove();pdBookCall('strategy_ioannis')">Ioannis</button>
    </div>
    <div class="modal-footer" style="justify-content:flex-end">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="document.getElementById('strategy-call-picker').remove()">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}
