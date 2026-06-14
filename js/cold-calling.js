import { state } from './app.js?v=20260603a';
import { invokeEdgeFunction, showToast } from './api.js?v=20260603a';
import { esc, svgIcon } from './utils.js?v=20260603a';
import { render } from './render.js?v=20260603a';

let _campaigns = null;
let _leads = [];
let _loading = false;
let _selectedCampaign = null;
let _dialCount = 0;
let _dialledIds = new Set();

async function loadCampaigns() {
  try {
    const resp = await invokeEdgeFunction('fetch-cold-leads', { action: 'list-campaigns' });
    _campaigns = resp.campaigns || [];
  } catch (e) {
    showToast('Failed to load campaigns: ' + e.message, 'error');
    _campaigns = [];
  }
}

async function loadLeads(campaignId, campaignName) {
  _loading = true;
  _leads = [];
  _selectedCampaign = { id: campaignId, name: campaignName };
  _dialCount = 0;
  _dialledIds = new Set();
  render();

  try {
    const resp = await invokeEdgeFunction('fetch-cold-leads', {
      action: 'fetch-leads',
      campaignId,
      campaignName,
    });
    _leads = resp.leads || [];
  } catch (e) {
    showToast('Failed to load leads: ' + e.message, 'error');
    _leads = [];
  }

  _loading = false;
  render();
}

function markDialled(leadId) {
  if (!_dialledIds.has(leadId)) {
    _dialledIds.add(leadId);
    _dialCount++;
  }
  render();
}

export function renderColdCallingTab() {
  if (!_campaigns) {
    loadCampaigns().then(() => render());
    return '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading campaigns...</div>';
  }

  let h = '<div style="max-width:900px;margin:0 auto;padding:16px 20px">';

  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:12px">
      <h2 style="margin:0;font-size:18px">Cold Calls</h2>
      <select id="cold-call-campaign" onchange="coldCallSelectCampaign(this)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);min-width:200px">
        <option value="">Select a campaign...</option>
        ${_campaigns.map(c => `<option value="${c.id}" ${_selectedCampaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;align-items:center;gap:12px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#16a34a">${_dialCount}</div>
        <div style="font-size:10px;color:#4d7c0f">Dials Today</div>
      </div>
      <div style="background:#f3f4f6;border:1px solid var(--border);border-radius:8px;padding:8px 16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:var(--text-primary)">${_leads.length}</div>
        <div style="font-size:10px;color:var(--text-muted)">Leads</div>
      </div>
    </div>
  </div>`;

  if (_loading) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)"><div class="loading-spinner"></div><div style="margin-top:12px">Pulling unresponsive leads from SmartLead...</div></div>';
    h += '</div>';
    return h;
  }

  if (!_selectedCampaign) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)">Select a campaign to load cold call leads.</div>';
    h += '</div>';
    return h;
  }

  if (_leads.length === 0) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted)">No unresponsive leads found in this campaign.</div>';
    h += '</div>';
    return h;
  }

  const callableLeads = _leads.filter(l => l.phone && l.grade !== 'C');
  h += `<div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="btn btn-primary" id="push-to-dialer-btn" onclick="pushToJustCallDialer()" style="display:flex;align-items:center;gap:6px">
      ${svgIcon('phone',14,'#fff')} Push ${callableLeads.length} A/B Leads to JustCall Dialer
    </button>
    <span style="font-size:11px;color:var(--text-muted);align-self:center">Skips C-grade and leads without phone numbers</span>
  </div>`;

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
    const dialled = _dialledIds.has(lead.id);
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email;
    const rowBg = dialled ? 'background:#f0fdf4' : '';

    const gradeColor = lead.grade === 'A' ? '#16a34a' : lead.grade === 'B' ? '#d97706' : '#9ca3af';
    const gradeBg = lead.grade === 'A' ? '#f0fdf4' : lead.grade === 'B' ? '#fffbeb' : '#f9fafb';

    h += `<tr style="border-bottom:1px solid #f3f4f6;${rowBg}">
      <td style="padding:6px 10px;color:var(--text-muted);text-align:center">${i + 1}</td>
      <td style="padding:6px 10px;text-align:center"><span style="font-size:11px;font-weight:700;color:${gradeColor};background:${gradeBg};padding:2px 8px;border-radius:4px">${lead.grade || '-'}</span></td>
      <td style="padding:6px 10px;font-weight:500">${esc(lead.companyName || '-')}</td>
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
  const id = el.value;
  if (!id) return;
  const campaign = _campaigns.find(c => String(c.id) === id);
  if (campaign) loadLeads(campaign.id, campaign.name);
};

window.coldCallDial = function(leadId, phone) {
  markDialled(leadId);
  if (window.justCallDial) {
    window.justCallDial(phone);
  } else {
    window.open('tel:' + phone);
  }
};

window.pushToJustCallDialer = async function() {
  const callableLeads = _leads.filter(l => l.phone && l.grade !== 'C');
  if (!callableLeads.length) { showToast('No callable leads to push', 'error'); return; }
  if (!_selectedCampaign) return;

  const btn = document.getElementById('push-to-dialer-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Pushing...'; }

  try {
    const campName = `Cold Calls - ${_selectedCampaign.name} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const result = await invokeEdgeFunction('justcall-dialer', {
      action: 'bulk-dial',
      leads: callableLeads,
      campaignName: campName,
    });
    showToast(`${result.added} leads pushed to JustCall campaign "${campName}"`, 'success');
    if (btn) btn.innerHTML = 'Pushed to JustCall';
  } catch (e) {
    showToast('Failed to push to dialer: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Push to JustCall Dialer'; }
  }
};
