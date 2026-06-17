import { state } from './app.js?v=20260616a';
import { invokeEdgeFunction, showToast } from './api.js?v=20260616a';
import { esc, svgIcon } from './utils.js?v=20260616a';
import { render } from './render.js?v=20260616a';
import { renderPowerDialer } from './power-dialer.js?v=20260616a';

let _campaigns = null;
let _leads = [];
let _loading = false;
let _syncing = false;
let _selectedCampaign = null;
let _dialCount = 0;

async function loadCampaigns() {
  try {
    const resp = await invokeEdgeFunction('fetch-cold-leads', { action: 'list-campaigns' });
    _campaigns = resp.campaigns || [];
  } catch (e) {
    showToast('Failed to load campaigns: ' + e.message, 'error');
    if (!_campaigns) _campaigns = [];
  }
}

async function syncCampaigns() {
  _syncing = true;
  render();
  try {
    await invokeEdgeFunction('fetch-cold-leads', { action: 'sync-campaigns' });
    await loadCampaigns();
    showToast('Campaigns synced from SmartLead', 'success');
  } catch (e) {
    showToast('Sync failed: ' + e.message, 'error');
  }
  _syncing = false;
  render();
}

async function loadLeads(campaignId) {
  _loading = true;
  _leads = [];
  render();
  try {
    const resp = await invokeEdgeFunction('fetch-cold-leads', { action: 'get-leads', campaignId });
    _leads = resp.leads || [];
    _dialCount = _leads.filter(l => l.dialled).length;
  } catch (e) {
    showToast('Failed to load leads: ' + e.message, 'error');
  }
  _loading = false;
  render();
}

async function syncLeads(campaignId, campaignName) {
  _syncing = true;
  render();
  try {
    const resp = await invokeEdgeFunction('fetch-cold-leads', { action: 'sync-leads', campaignId, campaignName });
    showToast(`${resp.synced} leads synced for ${campaignName}`, 'success');
    await loadLeads(campaignId);
    await loadCampaigns();
  } catch (e) {
    showToast('Lead sync failed: ' + e.message, 'error');
  }
  _syncing = false;
  render();
}

export function renderColdCallingTab() {
  const mode = state.coldCallMode || 'smartlead';
  const toggleCs = 'padding:5px 14px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid var(--border);transition:all .15s';

  let h = '<div style="max-width:1200px;margin:0 auto;padding:16px 20px">';
  h += `<div style="display:flex;gap:0;margin-bottom:16px">
    <button onclick="state.coldCallMode='smartlead';render()" style="${toggleCs};border-radius:6px 0 0 6px;${mode === 'smartlead' ? 'background:var(--purple);color:#fff;border-color:var(--purple)' : 'background:#fff;color:var(--text-muted)'}">SmartLead Leads</button>
    <button onclick="state.coldCallMode='power_dialer';render()" style="${toggleCs};border-radius:0 6px 6px 0;border-left:0;${mode === 'power_dialer' ? 'background:var(--purple);color:#fff;border-color:var(--purple)' : 'background:#fff;color:var(--text-muted)'}">Power Dialer</button>
  </div>`;

  if (mode === 'power_dialer') {
    return h + renderPowerDialer() + '</div>';
  }

  // SmartLead mode below
  if (!_campaigns) {
    loadCampaigns().then(() => render());
    return h + '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading campaigns...</div></div>';
  }

  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:12px">
      <h2 style="margin:0;font-size:18px">Cold Calls</h2>
      <select id="cold-call-campaign" onchange="coldCallSelectCampaign(this)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);min-width:200px">
        <option value="">Select a campaign...</option>
        ${_campaigns.map(c => `<option value="${c.id}" ${_selectedCampaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}${c.lead_count ? ' (' + c.lead_count + ')' : ''}</option>`).join('')}
      </select>
      <button class="btn btn-ghost" onclick="coldCallSyncCampaigns()" style="font-size:11px;padding:4px 8px" title="Refresh campaign list from SmartLead"${_syncing ? ' disabled' : ''}>${svgIcon('refresh-cw', 12)}</button>
    </div>
    <div style="display:flex;align-items:center;gap:12px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#16a34a">${_dialCount}</div>
        <div style="font-size:10px;color:#4d7c0f">Dialled</div>
      </div>
      <div style="background:#f3f4f6;border:1px solid var(--border);border-radius:8px;padding:8px 16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:var(--text-primary)">${_leads.length}</div>
        <div style="font-size:10px;color:var(--text-muted)">Leads</div>
      </div>
    </div>
  </div>`;

  if (_syncing) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)"><div class="loading-spinner"></div><div style="margin-top:12px">Syncing from SmartLead...</div></div></div>';
    return h;
  }

  if (_loading) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)"><div class="loading-spinner"></div><div style="margin-top:12px">Loading leads...</div></div></div>';
    return h;
  }

  if (!_selectedCampaign) {
    h += `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      ${_campaigns.length === 0 ? `<div>No campaigns synced yet.</div><button class="btn btn-primary" style="margin-top:12px" onclick="coldCallSyncCampaigns()">Sync Campaigns from SmartLead</button>` : 'Select a campaign to view cold call leads.'}
    </div></div>`;
    return h;
  }

  const syncedAt = _selectedCampaign.synced_at ? new Date(_selectedCampaign.synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

  h += `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
    <button class="btn btn-ghost" onclick="coldCallSyncLeads()" style="font-size:11px;display:flex;align-items:center;gap:4px">${svgIcon('refresh-cw', 12)} Sync Leads from SmartLead</button>
    <span style="font-size:10px;color:var(--text-muted)">Last synced: ${syncedAt}</span>`;

  if (_leads.length > 0) {
    const callableLeads = _leads.filter(l => l.phone && l.grade !== 'C');
    h += `<button class="btn btn-primary" id="push-to-dialer-btn" onclick="pushToJustCallDialer()" style="font-size:11px;margin-left:auto;display:flex;align-items:center;gap:4px">${svgIcon('phone', 12, '#fff')} Push ${callableLeads.length} A/B to JustCall</button>`;
  }
  h += '</div>';

  if (_leads.length === 0) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)">No leads synced for this campaign. Click "Sync Leads" to pull from SmartLead.</div></div>';
    return h;
  }

  h += `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:center;font-weight:600;width:30px">#</th>
        <th style="padding:8px 10px;text-align:center;font-weight:600;width:30px">Grade</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Company</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Contact</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Title</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Phone</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Email</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Location</th>
        <th style="padding:8px 10px;text-align:center;font-weight:600">Action</th>
      </tr></thead>
      <tbody>`;

  for (let i = 0; i < _leads.length; i++) {
    const lead = _leads[i];
    const dialled = lead.dialled;
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
    const rowBg = dialled ? 'background:#f0fdf4' : '';
    const gradeColor = lead.grade === 'A' ? '#16a34a' : lead.grade === 'B' ? '#d97706' : '#9ca3af';
    const gradeBg = lead.grade === 'A' ? '#f0fdf4' : lead.grade === 'B' ? '#fffbeb' : '#f9fafb';

    h += `<tr style="border-bottom:1px solid #f3f4f6;${rowBg}">
      <td style="padding:6px 10px;color:var(--text-muted);text-align:center">${i + 1}</td>
      <td style="padding:6px 10px;text-align:center"><span style="font-size:11px;font-weight:700;color:${gradeColor};background:${gradeBg};padding:2px 8px;border-radius:4px">${lead.grade || '-'}</span></td>
      <td style="padding:6px 10px;font-weight:500">${esc(lead.company_name || '-')}</td>
      <td style="padding:6px 10px">${esc(name)}</td>
      <td style="padding:6px 10px;color:var(--text-muted)">${esc(lead.title || '-')}</td>
      <td style="padding:6px 10px">${lead.phone ? `<a href="tel:${esc(lead.phone)}" style="color:#2563eb;text-decoration:none">${esc(lead.phone)}</a>` : '<span style="color:#d1d5db">No phone</span>'}</td>
      <td style="padding:6px 10px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(lead.email)}</td>
      <td style="padding:6px 10px;color:var(--text-muted)">${esc(lead.location || '-')}</td>
      <td style="padding:6px 10px;text-align:center">
        ${dialled
          ? '<span style="color:#16a34a;font-weight:600;font-size:11px">Dialled</span>'
          : lead.phone
            ? `<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="event.stopPropagation();coldCallDial(${lead.id},'${esc(lead.phone)}')">Call</button>`
            : '<span style="color:#d1d5db;font-size:10px">No #</span>'
        }
      </td>
    </tr>`;
  }

  h += '</tbody></table></div></div>';
  return h;
}

window.coldCallSelectCampaign = function(el) {
  const id = Number(el.value);
  if (!id) { _selectedCampaign = null; _leads = []; render(); return; }
  const campaign = _campaigns.find(c => c.id === id);
  if (campaign) {
    _selectedCampaign = campaign;
    loadLeads(campaign.id);
  }
};

window.coldCallSyncCampaigns = () => syncCampaigns();
window.coldCallSyncLeads = () => {
  if (_selectedCampaign) syncLeads(_selectedCampaign.id, _selectedCampaign.name);
};

window.coldCallDial = async function(leadId, phone) {
  try {
    await invokeEdgeFunction('fetch-cold-leads', { action: 'mark-dialled', leadId });
    const lead = _leads.find(l => l.id === leadId);
    if (lead) { lead.dialled = true; _dialCount = _leads.filter(l => l.dialled).length; }
    render();
  } catch (_) { /* non-fatal */ }
  if (window.justCallDial) {
    window.justCallDial(phone);
  } else {
    window.open('tel:' + phone);
  }
};

window.pushToJustCallDialer = async function() {
  const callableLeads = _leads.filter(l => l.phone && l.grade !== 'C' && !l.dialled);
  if (!callableLeads.length) { showToast('No callable leads to push', 'error'); return; }
  if (!_selectedCampaign) return;

  const btn = document.getElementById('push-to-dialer-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing...'; }

  try {
    const campName = `Cold Calls - ${_selectedCampaign.name} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const result = await invokeEdgeFunction('justcall-dialer', {
      action: 'bulk-dial',
      leads: callableLeads.map(l => ({
        phone: l.phone,
        firstName: l.first_name,
        lastName: l.last_name,
        email: l.email,
        companyName: l.company_name,
      })),
      campaignName: campName,
    });
    showToast(`${result.added} leads pushed to JustCall "${campName}"`, 'success');
    if (btn) btn.textContent = 'Pushed';
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Push to JustCall'; }
  }
};
