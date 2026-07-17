// ═══════════════════════════════════════════════════════════
// WON-MODAL — Closed-Won drop (Acquisition): route retainer/PPL,
// create client + lead sheet + SmartLead tags. Blocking, ordered,
// stop-on-failure with Retry. Body-level overlay (survives render()).
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260717g';
import { str, esc, getToday } from './utils.js?v=20260717g';
import { createClientRecord, deriveTimezone } from './client-info.js?v=20260717g';
import { ensureLeadTrackerSheet } from './lead-tracker-sheet.js?v=20260717g';
import { invokeEdgeFunction, showToast } from './api.js?v=20260717g';
import { isAdmin } from './auth.js?v=20260717g';

let _w = null; // { deal, clientId, sheetId, tagsDone }
const CURRENCIES = ['USD', 'AUD', 'CAD'];
const TERMS_PPL = ['Net 7', 'Net 15', 'Net 30'];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function findDuplicate(name) {
  const n = norm(name);
  if (!n) return null;
  return state.clients.find((c) => {
    const cn = norm(str(c.name));
    return cn === n || cn.includes(n) || n.includes(cn);
  }) || null;
}

const inp = (id, value, ph = '') =>
  `<input id="${id}" value="${esc(str(value))}" placeholder="${esc(ph)}" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px">`;
const lbl = (t) => `<label style="font-size:11px;font-weight:600;color:#64748b">${t}</label>`;
const val = (id) => (document.getElementById(id)?.value || '').trim();

export function openWonModal(deal) {
  if (!isAdmin()) return; // admin-only
  const name = str(deal.company || deal.contact || '').trim();
  _w = { deal, clientId: '', sheetId: '', tagsDone: false };
  const tz = deriveTimezone(str(deal.location || deal.address || ''));
  const dup = findDuplicate(name);
  const dupBanner = dup
    ? `<div style="margin:0 0 12px;padding:10px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e">
        Possible duplicate: <strong>${esc(dup.name)}</strong> already exists.
        <label style="display:block;margin-top:6px"><input type="checkbox" id="won-dup-override"> Create anyway</label>
        <button onclick="wonModalLink('${esc(dup.name)}')" style="margin-top:6px;padding:4px 10px;background:#f59e0b;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">Link to existing instead</button>
      </div>`
    : '';
  const html = `<div id="won-overlay" style="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)wonModalDismiss()">
    <div style="background:#fff;border-radius:12px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)" onclick="event.stopPropagation()">
      <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:17px;color:#1e293b">Close Won — Create Client</h2>
        <button onclick="wonModalDismiss()" style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div id="won-body" style="padding:20px 22px;max-height:72vh;overflow-y:auto">
        ${dupBanner}
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button id="won-type-retainer" onclick="wonModalToggleType('retainer')" style="flex:1;padding:9px;border:2px solid #4f46e5;background:#eef2ff;color:#4f46e5;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">Retainer</button>
          <button id="won-type-ppl" onclick="wonModalToggleType('per_lead')" style="flex:1;padding:9px;border:2px solid #cbd5e1;background:#fff;color:#64748b;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">PPL (per-meeting)</button>
        </div>
        <input type="hidden" id="won-billing" value="retainer">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="grid-column:1/3">${lbl('Client name')}${inp('won-name', name)}</div>
          <div>${lbl('Primary contact')}${inp('won-contact', str(deal.contact))}</div>
          <div>${lbl('Primary email')}${inp('won-email', str(deal.email))}</div>
          <div>${lbl('Phone')}${inp('won-phone', str(deal.phone || deal.mobilePhone))}</div>
          <div>${lbl('Website')}${inp('won-website', str(deal.website))}</div>
          <div>${lbl('Location')}${inp('won-location', str(deal.location))}</div>
          <div>${lbl('Timezone')}${inp('won-tz', tz)}</div>
          <div style="grid-column:1/3">${lbl('Address')}${inp('won-address', str(deal.address))}</div>
        </div>
        <div id="won-billing-fields" style="margin-top:14px"></div>
      </div>
      <div id="won-footer" style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px">
        <button onclick="wonModalDismiss()" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
        <button onclick="wonModalSubmit()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Create Client</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  renderBillingFields('retainer');
}

function renderBillingFields(type) {
  const el = document.getElementById('won-billing-fields');
  if (!el) return;
  if (type === 'retainer') {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${lbl('Monthly amount')}${inp('won-amount', '', 'e.g. 3000')}</div>
      <div>${lbl('Currency')}<select id="won-currency" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px">${CURRENCIES.map((c) => `<option value="${c.toLowerCase()}">${c}</option>`).join('')}</select></div>
      <div style="grid-column:1/3">${lbl('Payment terms')}${inp('won-terms', 'Monthly')}</div>
      <div style="grid-column:1/3">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#64748b"><input type="checkbox" id="won-launch-tbd" checked onchange="wonToggleLaunchTBD()"> Launch date TBD (set later in Settings)</label>
        <input type="date" id="won-launch" disabled style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px;opacity:.5">
      </div>
    </div>`;
  } else {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${lbl('Per-meeting cost')}${inp('won-cost', '', 'e.g. 250')}</div>
      <div>${lbl('Payment terms')}<select id="won-terms-sel" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px">${TERMS_PPL.map((t) => `<option>${t}</option>`).join('')}</select></div>
    </div>`;
  }
}

export function wonModalToggleType(type) {
  document.getElementById('won-billing').value = type;
  const r = document.getElementById('won-type-retainer');
  const p = document.getElementById('won-type-ppl');
  const on = 'border:2px solid #4f46e5;background:#eef2ff;color:#4f46e5;';
  const off = 'border:2px solid #cbd5e1;background:#fff;color:#64748b;';
  const base = 'flex:1;padding:9px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;';
  r.style.cssText = base + (type === 'retainer' ? on : off);
  p.style.cssText = base + (type === 'per_lead' ? on : off);
  renderBillingFields(type);
}

export function wonToggleLaunchTBD() {
  const tbd = document.getElementById('won-launch-tbd')?.checked;
  const d = document.getElementById('won-launch');
  if (d) { d.disabled = !!tbd; d.style.opacity = tbd ? '.5' : '1'; if (tbd) d.value = ''; }
}

export function wonModalDismiss() {
  document.getElementById('won-overlay')?.remove();
  _w = null;
}

function buildFields() {
  const type = document.getElementById('won-billing').value;
  const contact = val('won-contact');
  const parts = contact.split(' ');
  const f = {
    name: val('won-name'),
    contactFirstName: parts[0] || '',
    contactLastName: parts.slice(1).join(' ') || '',
    notifyEmail: val('won-email'),
    notifyEmails: val('won-email'),
    clientPhone: val('won-phone'),
    notifyPhone: val('won-phone'),
    website: val('won-website'),
    location: val('won-location'),
    timeZone: val('won-tz'),
    address: val('won-address'),
    status: 'active',
    activatedDate: getToday(),
    billingModel: type,
  };
  if (type === 'retainer') {
    f.monthlyRetainer = parseFloat(val('won-amount')) || null;
    f.retainerCurrency = document.getElementById('won-currency')?.value || 'usd';
    f.paymentTerms = val('won-terms') || 'Monthly';
    const tbd = document.getElementById('won-launch-tbd')?.checked;
    const ld = document.getElementById('won-launch')?.value;
    f.launchDate = (!tbd && ld) ? ld : ''; // blank/TBD → stored as null
  } else {
    f.leadCost = val('won-cost') || '';
    f.paymentTerms = document.getElementById('won-terms-sel')?.value || 'Net 7';
  }
  return f;
}

const STEPS = ['Create client record', 'Create Lead Tracker sheet', 'Create SmartLead tags', 'Move deal to Won'];

function setFooterProgress(activeIdx, failedIdx) {
  const f = document.getElementById('won-footer');
  if (!f) return;
  const rows = STEPS.map((s, i) => {
    let icon = '○';
    let col = '#94a3b8';
    if (i < activeIdx) { icon = '✓'; col = '#16a34a'; }
    else if (i === failedIdx) { icon = '✗'; col = '#dc2626'; }
    else if (i === activeIdx && failedIdx == null) { icon = '⏳'; col = '#4f46e5'; }
    return `<div style="font-size:12px;color:${col}">${icon} ${s}</div>`;
  }).join('');
  const btns = failedIdx != null
    ? `<button onclick="wonModalDismiss()" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
       <button onclick="wonModalRetry()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Retry</button>`
    : '<span style="font-size:12px;color:#64748b">Working…</span>';
  f.style.cssText = 'padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center';
  f.innerHTML = `<div style="display:flex;flex-direction:column;gap:3px">${rows}</div><div style="display:flex;gap:8px">${btns}</div>`;
}

export async function wonModalSubmit() {
  const f = buildFields();
  if (!f.name) { showToast('Client name is required', 'error'); return; }
  const dup = findDuplicate(f.name);
  if (dup && !document.getElementById('won-dup-override')?.checked) {
    showToast('Duplicate client — check "Create anyway" or Link to existing', 'warning');
    return;
  }
  await runSteps(f, 0);
}

// Retry resumes from the first not-yet-completed step (idempotent).
export async function wonModalRetry() {
  const startIdx = _w.clientId ? (_w.sheetId ? 2 : 1) : 0;
  await runSteps(buildFields(), startIdx);
}

async function runSteps(f, startIdx) {
  try {
    setFooterProgress(startIdx, null);
    if (startIdx <= 0) {
      const c = await createClientRecord(f);
      _w.clientId = c.id;
    }
    setFooterProgress(1, null);
    if (startIdx <= 1) {
      _w.sheetId = await ensureLeadTrackerSheet(_w.clientId, f.name, f.billingModel === 'retainer');
    }
    setFooterProgress(2, null);
    if (startIdx <= 2 && !_w.tagsDone) {
      const r = await invokeEdgeFunction('create-smartlead-tags', { clientName: f.name });
      if (r?.error) throw new Error('SmartLead tags: ' + r.error);
      _w.tagsDone = true;
    }
    setFooterProgress(3, null);
    const dealId = _w.deal.id;
    const clientName = f.name;
    wonModalDismiss();
    const { deleteDeal } = await import('./deals.js?v=20260717g');
    deleteDeal(dealId, 'Closed Won', clientName);
    showToast(`Client "${clientName}" created and deal won`, 'success');
  } catch (e) {
    const failedIdx = _w.clientId ? (_w.sheetId ? 2 : 1) : 0;
    setFooterProgress(failedIdx, failedIdx);
    showToast('Step failed: ' + (e?.message || e), 'error');
  }
}

export async function wonModalLink(existingName) {
  const dealId = _w.deal.id;
  wonModalDismiss();
  const { deleteDeal } = await import('./deals.js?v=20260717g');
  deleteDeal(dealId, 'Closed Won', existingName);
  showToast(`Deal linked to existing client "${existingName}"`, 'success');
}

window.wonModalSubmit = wonModalSubmit;
window.wonModalDismiss = wonModalDismiss;
window.wonModalRetry = wonModalRetry;
window.wonModalToggleType = wonModalToggleType;
window.wonToggleLaunchTBD = wonToggleLaunchTBD;
window.wonModalLink = wonModalLink;
