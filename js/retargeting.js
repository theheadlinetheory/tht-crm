import { state, store, pendingWrites } from './app.js?v=20260515c';
import {
  sbCreateRetargetHistory, sbCreateRetargetExport, sbUpdateRetargetExport,
  sbUpdateRetargetHistory, sbBatchUpdateDeals, sbUpdateDeal, camelToSnake
} from './api.js?v=20260515c';
import { render } from './render.js?v=20260515c';
import { isAdmin } from './auth.js?v=20260515c';
import { esc, svgIcon } from './utils.js?v=20260515c';
import {
  RETARGET_ELIGIBLE_STAGES, RETARGET_SPOKE_BEFORE_STAGES,
  RETARGET_NEVER_CONNECTED_STAGES, RETARGET_MIN_STALE_DAYS, RETARGET_MAX_ATTEMPTS
} from './config.js?v=20260515c';

// ─── Pool Logic ───

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d)) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function getRetargetableDeals() {
  const minDays = state.retargetFilters.minDays || RETARGET_MIN_STALE_DAYS;
  return state.deals.filter(d => {
    if (!RETARGET_ELIGIBLE_STAGES.includes(d.stage)) return false;
    if (daysSince(d.updatedAt || d.lastUpdated || d.createdAt) < minDays) return false;
    if (d.retargetStatus === 'exported' || d.retargetStatus === 'active') return false;
    if (Number(d.retargetCount || 0) >= RETARGET_MAX_ATTEMPTS) return false;
    return true;
  });
}

function getFilteredPool() {
  let deals = getRetargetableDeals();
  const f = state.retargetFilters;
  if (f.stage) deals = deals.filter(d => d.stage === f.stage);
  if (f.campaign) deals = deals.filter(d => (d.campaignName || '').toLowerCase().includes(f.campaign.toLowerCase()));
  if (f.location) deals = deals.filter(d => (d.location || '').toLowerCase().includes(f.location.toLowerCase()));
  if (f.pipeline) deals = deals.filter(d => {
    if (f.pipeline === 'Acquisition') return d.pipeline === 'Acquisition';
    if (f.pipeline === 'Nurture') return d.pipeline !== 'Acquisition';
    return true;
  });
  return deals;
}

function getSegmentType(stage) {
  return RETARGET_SPOKE_BEFORE_STAGES.includes(stage) ? 'spoke_before' : 'never_connected';
}

function getRetargetHistoryForDeal(dealId) {
  return state.retargetHistory.filter(h => String(h.dealId) === String(dealId));
}

// ─── Pool Rendering ───

function renderFilters() {
  const f = state.retargetFilters;
  const selStyle = 'padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);outline:none';
  const inputStyle = selStyle + ';width:140px';
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <select onchange="setRetargetFilter('stage',this.value)" style="${selStyle}">
      <option value="">All Stages</option>
      ${RETARGET_ELIGIBLE_STAGES.map(s => `<option value="${esc(s)}" ${f.stage===s?'selected':''}>${esc(s)}</option>`).join('')}
    </select>
    <select onchange="setRetargetFilter('minDays',this.value)" style="${selStyle}">
      <option value="90" ${String(f.minDays)==='90'?'selected':''}>90+ days</option>
      <option value="180" ${String(f.minDays)==='180'?'selected':''}>180+ days</option>
      <option value="30" ${String(f.minDays)==='30'?'selected':''}>30+ days</option>
    </select>
    <input type="text" placeholder="Campaign..." value="${esc(f.campaign)}" oninput="setRetargetFilter('campaign',this.value)" style="${inputStyle}">
    <input type="text" placeholder="Location..." value="${esc(f.location)}" oninput="setRetargetFilter('location',this.value)" style="${inputStyle}">
    <select onchange="setRetargetFilter('pipeline',this.value)" style="${selStyle}">
      <option value="">All Pipelines</option>
      <option value="Acquisition" ${f.pipeline==='Acquisition'?'selected':''}>Acquisition</option>
      <option value="Nurture" ${f.pipeline==='Nurture'?'selected':''}>Nurture</option>
    </select>
  </div>`;
}

function renderPoolTable(deals) {
  if (!deals.length) {
    return `<div style="text-align:center;padding:40px;color:var(--text-muted)">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">No retargetable leads</div>
      <div style="font-size:12px">Leads appear here when they've been in No Show, Closed Lost, Not Now, or Service Area Taken for 90+ days.</div>
    </div>`;
  }

  const allSelected = deals.length > 0 && deals.every(d => state.retargetSelected.has(d.id));
  let h = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;width:30px"><input type="checkbox" ${allSelected?'checked':''} onchange="toggleRetargetSelectAll(this.checked)"></th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Contact</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Company</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Email</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Stage</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Days Stale</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Campaign</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Prior Interaction</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Retargets</th>
      </tr></thead><tbody>`;

  for (const d of deals) {
    const stale = daysSince(d.updatedAt || d.lastUpdated || d.createdAt);
    const history = getRetargetHistoryForDeal(d.id);
    const snippet = d.replySnippet || d.emailBody ? (d.replySnippet || d.emailBody).slice(0, 60) + '...' : 'No response';
    const checked = state.retargetSelected.has(d.id);
    const segColor = RETARGET_SPOKE_BEFORE_STAGES.includes(d.stage) ? '#2563eb' : '#d97706';

    h += `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="openDeal('${d.id}')">
      <td style="padding:8px 10px" onclick="event.stopPropagation()"><input type="checkbox" ${checked?'checked':''} onchange="toggleRetargetSelect('${d.id}')"></td>
      <td style="padding:8px 10px;font-weight:600">${esc(d.contact || d.company || '—')}</td>
      <td style="padding:8px 10px">${esc(d.company || '—')}</td>
      <td style="padding:8px 10px;color:var(--text-muted)">${esc(d.email || '—')}</td>
      <td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${segColor}15;color:${segColor}">${esc(d.stage)}</span></td>
      <td style="padding:8px 10px;font-weight:600;color:${stale>180?'#ef4444':stale>90?'#d97706':'var(--text-muted)'}">${stale}d</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-muted)">${esc(d.campaignName || '—')}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(snippet)}</td>
      <td style="padding:8px 10px;text-align:center"><span style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">${history.length}</span></td>
    </tr>`;
  }

  h += '</tbody></table></div>';
  return h;
}

// ─── Campaign Builder Modal ───

function renderCampaignBuilder() {
  if (!state.retargetBuilderStep) return '';
  const step = state.retargetBuilderStep;
  const leads = state.retargetBuilderLeads;
  const spokeBefore = leads.filter(d => RETARGET_SPOKE_BEFORE_STAGES.includes(d.stage));
  const neverConnected = leads.filter(d => RETARGET_NEVER_CONNECTED_STAGES.includes(d.stage));

  let body = '';

  if (step === 1) {
    body = `<div>
      <label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Campaign Name</label>
      <input id="retarget-campaign-name" value="${esc(state.retargetBuilderName)}" placeholder="e.g. Q2 2026 No-Show Re-engagement"
        oninput="state.retargetBuilderName=this.value"
        style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      <div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px">${leads.length} leads selected</div>
        <div style="font-size:12px;color:var(--text-muted)">
          ${RETARGET_ELIGIBLE_STAGES.map(s => {
            const count = leads.filter(d => d.stage === s).length;
            return count ? `<div>${s}: ${count}</div>` : '';
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  if (step === 2) {
    body = `<div>
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Auto-Segmentation</div>
      <div style="display:grid;gap:12px">
        <div style="padding:12px;border:1px solid #2563eb30;border-radius:8px;background:#2563eb08">
          <div style="font-size:12px;font-weight:700;color:#2563eb;margin-bottom:4px">Spoke Before (${spokeBefore.length})</div>
          <div style="font-size:11px;color:var(--text-muted)">Closed Lost, Not Now — "Reaching back out since we connected previously..."</div>
        </div>
        <div style="padding:12px;border:1px solid #d9770630;border-radius:8px;background:#d9770608">
          <div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:4px">Never Connected (${neverConnected.length})</div>
          <div style="font-size:11px;color:var(--text-muted)">No Show, Service Area Taken — "I know you booked a call with us before but we never got a chance to speak..."</div>
        </div>
      </div>
    </div>`;
  }

  if (step === 3) {
    const vr = state.retargetValidationResults;
    if (state.retargetValidating) {
      body = `<div style="text-align:center;padding:20px">
        <div class="loading-spinner" style="margin:0 auto 12px"></div>
        <div style="font-size:13px;color:var(--text-muted)">Validating ${leads.length} email addresses...</div>
      </div>`;
    } else if (vr) {
      body = `<div>
        <div style="font-size:13px;font-weight:700;margin-bottom:12px">Email Validation Results</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="padding:12px;background:#05966910;border-radius:8px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#059669">${vr.valid}</div>
            <div style="font-size:11px;color:#059669;font-weight:600">Valid</div>
          </div>
          <div style="padding:12px;background:#ef444410;border-radius:8px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#ef4444">${vr.invalid}</div>
            <div style="font-size:11px;color:#ef4444;font-weight:600">Removed</div>
          </div>
        </div>
        ${vr.invalidEmails.length ? `<div style="margin-top:12px;font-size:11px;color:var(--text-muted);max-height:100px;overflow-y:auto">
          <div style="font-weight:600;margin-bottom:4px">Removed emails:</div>
          ${vr.invalidEmails.map(e => `<div>${esc(e)}</div>`).join('')}
        </div>` : ''}
      </div>`;
    } else {
      body = `<div style="text-align:center;padding:20px">
        <div style="font-size:13px;margin-bottom:12px">Validate all email addresses before export.</div>
        <button class="btn btn-primary" onclick="runRetargetValidation()">Validate Emails</button>
      </div>`;
    }
  }

  if (step === 4) {
    body = `<div>
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Ready to Export</div>
      <div style="padding:12px;background:#f9fafb;border-radius:8px;font-size:12px">
        <div><strong>Campaign:</strong> ${esc(state.retargetBuilderName)}</div>
        <div><strong>Leads:</strong> ${state.retargetValidationResults ? state.retargetValidationResults.valid : leads.length}</div>
        <div><strong>Spoke Before:</strong> ${spokeBefore.length}</div>
        <div><strong>Never Connected:</strong> ${neverConnected.length}</div>
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
        Export will save to Supabase and generate a downloadable JSON file for Lars' dashboard.
      </div>
    </div>`;
  }

  const stepLabels = ['Name', 'Segments', 'Validate', 'Export'];
  const canNext = step === 1 ? state.retargetBuilderName.trim().length > 0
    : step === 3 ? !!state.retargetValidationResults
    : true;

  return `<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this)closeRetargetBuilder()">
    <div class="modal" style="width:500px" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Create Retargeting Campaign</h3>
        <button class="modal-close" onclick="closeRetargetBuilder()">×</button>
      </div>
      <div style="padding:0 20px;display:flex;gap:0;margin-bottom:4px">
        ${stepLabels.map((l, i) => `<div style="flex:1;text-align:center;padding:8px 0;font-size:11px;font-weight:600;color:${step===i+1?'var(--purple)':'var(--text-muted)'};border-bottom:2px solid ${step===i+1?'var(--purple)':'transparent'}">${i+1}. ${l}</div>`).join('')}
      </div>
      <div class="modal-body" style="min-height:200px">${body}</div>
      <div class="modal-footer" style="justify-content:space-between">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="${step===1?'closeRetargetBuilder()':'prevRetargetStep()'}">${step===1?'Cancel':'Back'}</button>
        ${step < 4
          ? `<button class="btn btn-primary" onclick="nextRetargetStep()" ${!canNext?'disabled':''}>${step===3 && !state.retargetValidationResults?'Skip Validation':'Next'}</button>`
          : `<button class="btn btn-primary" onclick="executeRetargetExport()">Export Campaign</button>`}
      </div>
    </div>
  </div>`;
}

// ─── Export History ───

function renderExportHistory() {
  const exports = state.retargetExports;
  if (!exports.length) return '';

  let h = `<div style="margin-top:24px">
    <div style="font-size:14px;font-weight:700;margin-bottom:8px">Export History</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
          <th style="padding:8px 10px;text-align:left;font-weight:600">Campaign</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Leads</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Exported</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Status</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Actions</th>
        </tr></thead><tbody>`;

  for (const exp of exports) {
    const statusColors = { exported: '#d97706', active: '#059669', completed: '#6b7280' };
    const statusColor = statusColors[exp.status] || '#6b7280';
    const date = exp.exportedAt ? new Date(exp.exportedAt).toLocaleDateString() : '—';

    h += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-weight:600">${esc(exp.campaignName)}</td>
      <td style="padding:8px 10px">${exp.leadCount || 0}</td>
      <td style="padding:8px 10px;color:var(--text-muted)">${date}</td>
      <td style="padding:8px 10px"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${statusColor}15;color:${statusColor}">${esc(exp.status)}</span></td>
      <td style="padding:8px 10px;display:flex;gap:4px">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="downloadRetargetExport('${exp.id}')">Download</button>
        ${exp.status === 'exported' ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="markRetargetActive('${exp.id}')">Mark Active</button>` : ''}
        ${exp.status === 'active' ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="markRetargetComplete('${exp.id}')">Mark Complete</button>` : ''}
      </td>
    </tr>`;
  }

  h += '</tbody></table></div></div>';
  return h;
}

// ─── Main Tab Render ───

export function renderRetargetingTab() {
  if (!isAdmin()) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">Access restricted.</div>';

  const pool = getFilteredPool();
  const selectedCount = state.retargetSelected.size;

  let html = `<div style="padding:16px 20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:800">Retargeting Pool</div>
        <div style="font-size:12px;color:var(--text-muted)">${pool.length} leads eligible for re-engagement</div>
      </div>
      <div style="display:flex;gap:8px">
        ${selectedCount > 0 ? `<button class="btn btn-primary" onclick="openRetargetBuilder()">Create Campaign (${selectedCount})</button>` : `<button class="btn btn-primary" disabled>Select leads to create campaign</button>`}
      </div>
    </div>
    ${renderFilters()}
    ${renderPoolTable(pool)}
    ${renderExportHistory()}
  </div>`;

  html += renderCampaignBuilder();

  return html;
}

// ─── Actions ───

function openRetargetBuilder() {
  const selected = state.deals.filter(d => state.retargetSelected.has(d.id));
  if (!selected.length) return;
  state.retargetBuilderStep = 1;
  state.retargetBuilderName = '';
  state.retargetBuilderLeads = selected;
  state.retargetValidationResults = null;
  state.retargetValidating = false;
  render();
}

function closeRetargetBuilder() {
  state.retargetBuilderStep = 0;
  state.retargetBuilderLeads = [];
  state.retargetValidationResults = null;
  state.retargetValidating = false;
  render();
}

function nextRetargetStep() {
  if (state.retargetBuilderStep < 4) {
    state.retargetBuilderStep++;
    render();
  }
}

function prevRetargetStep() {
  if (state.retargetBuilderStep > 1) {
    state.retargetBuilderStep--;
    render();
  }
}

function setRetargetFilter(key, value) {
  state.retargetFilters[key] = value;
  render();
}

function toggleRetargetSelect(dealId) {
  if (state.retargetSelected.has(dealId)) {
    state.retargetSelected.delete(dealId);
  } else {
    state.retargetSelected.add(dealId);
  }
  render();
}

function toggleRetargetSelectAll(checked) {
  const pool = getFilteredPool();
  if (checked) {
    pool.forEach(d => state.retargetSelected.add(d.id));
  } else {
    state.retargetSelected.clear();
  }
  render();
}

async function runRetargetValidation() {
  state.retargetValidating = true;
  render();

  const leads = state.retargetBuilderLeads;
  const validLeads = [];
  const invalidEmails = [];

  for (const d of leads) {
    if (d.email && d.email.includes('@') && d.email.includes('.')) {
      validLeads.push(d);
    } else {
      invalidEmails.push(d.email || '(empty)');
    }
  }

  state.retargetBuilderLeads = validLeads;
  state.retargetValidationResults = {
    valid: validLeads.length,
    invalid: invalidEmails.length,
    invalidEmails
  };
  state.retargetValidating = false;
  render();
}

async function executeRetargetExport() {
  const leads = state.retargetBuilderLeads;
  const campaignName = state.retargetBuilderName.trim();
  if (!campaignName || !leads.length) return;

  const spokeBefore = leads.filter(d => RETARGET_SPOKE_BEFORE_STAGES.includes(d.stage));
  const neverConnected = leads.filter(d => RETARGET_NEVER_CONNECTED_STAGES.includes(d.stage));

  const payload = {
    campaign_name: campaignName,
    created_at: new Date().toISOString(),
    total_leads: leads.length,
    segments: [
      {
        type: 'spoke_before',
        leads: spokeBefore.map(d => ({
          email: d.email || '', first_name: (d.contact || '').split(' ')[0] || '',
          last_name: (d.contact || '').split(' ').slice(1).join(' ') || '',
          company: d.company || '', phone: d.phone || '',
          linkedin_url: d.linkedinUrl || '', location: d.location || '',
          job_title: d.jobTitle || '', original_campaign: d.campaignName || '',
          original_stage: d.stage || '',
          last_interaction_date: d.updatedAt || d.lastUpdated || d.createdAt || '',
          reply_snippet: d.replySnippet || ''
        }))
      },
      {
        type: 'never_connected',
        leads: neverConnected.map(d => ({
          email: d.email || '', first_name: (d.contact || '').split(' ')[0] || '',
          last_name: (d.contact || '').split(' ').slice(1).join(' ') || '',
          company: d.company || '', phone: d.phone || '',
          linkedin_url: d.linkedinUrl || '', location: d.location || '',
          job_title: d.jobTitle || '', original_campaign: d.campaignName || '',
          original_stage: d.stage || '',
          last_interaction_date: d.updatedAt || d.lastUpdated || d.createdAt || '',
          reply_snippet: ''
        }))
      }
    ]
  };

  try {
    const exportRecord = await sbCreateRetargetExport({
      campaign_name: campaignName,
      payload,
      lead_count: leads.length,
      exported_by: 'admin',
      status: 'exported'
    });

    const now = new Date().toISOString();

    for (const d of leads) {
      const newCount = (Number(d.retargetCount || 0) + 1);
      await sbUpdateDeal(d.id, camelToSnake({
        retargetCampaign: campaignName,
        retargetDate: now,
        retargetStatus: 'exported',
        retargetCount: String(newCount)
      }));
      await sbCreateRetargetHistory({
        deal_id: d.id,
        campaign_name: campaignName,
        segment_type: getSegmentType(d.stage),
        status: 'exported'
      });
      store.updateDeal(d.id, {
        retargetCampaign: campaignName,
        retargetDate: now,
        retargetStatus: 'exported',
        retargetCount: String(newCount)
      }, { silent: true });
    }

    state.retargetExports.unshift(localNormalizeRow(exportRecord));

    downloadPayload(payload, campaignName);

    state.retargetBuilderStep = 0;
    state.retargetBuilderLeads = [];
    state.retargetSelected.clear();
    state.retargetValidationResults = null;
    render();
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

function localNormalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    normalized[camelKey] = value != null ? (typeof value === 'object' ? value : String(value)) : '';
  }
  return normalized;
}

function downloadPayload(payload, campaignName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retarget_${campaignName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadRetargetExport(exportId) {
  const exp = state.retargetExports.find(e => String(e.id) === String(exportId));
  if (!exp || !exp.payload) return;
  const payload = typeof exp.payload === 'string' ? JSON.parse(exp.payload) : exp.payload;
  downloadPayload(payload, exp.campaignName || 'retarget');
}

async function markRetargetActive(exportId) {
  await sbUpdateRetargetExport(exportId, { status: 'active' });
  const exp = state.retargetExports.find(e => String(e.id) === String(exportId));
  if (exp) exp.status = 'active';

  const campaignName = exp?.campaignName;
  if (campaignName) {
    state.deals.filter(d => d.retargetCampaign === campaignName && d.retargetStatus === 'exported').forEach(d => {
      d.retargetStatus = 'active';
      sbUpdateDeal(d.id, camelToSnake({ retargetStatus: 'active' }));
    });
    state.retargetHistory.filter(h => h.campaignName === campaignName && h.status === 'exported').forEach(h => {
      h.status = 'active';
      sbUpdateRetargetHistory(h.id, { status: 'active' });
    });
  }
  render();
}

async function markRetargetComplete(exportId) {
  await sbUpdateRetargetExport(exportId, { status: 'completed' });
  const exp = state.retargetExports.find(e => String(e.id) === String(exportId));
  if (exp) exp.status = 'completed';

  const campaignName = exp?.campaignName;
  if (campaignName) {
    state.deals.filter(d => d.retargetCampaign === campaignName && d.retargetStatus === 'active').forEach(d => {
      d.retargetStatus = 'no_response';
      d.retargetCampaign = '';
      sbUpdateDeal(d.id, camelToSnake({ retargetStatus: 'no_response', retargetCampaign: null }));
    });
    state.retargetHistory.filter(h => h.campaignName === campaignName && h.status === 'active').forEach(h => {
      h.status = 'no_response';
      sbUpdateRetargetHistory(h.id, { status: 'no_response' });
    });
  }
  render();
}

// ─── Retarget History for Deal Modal ───

export function renderDealRetargetHistory(dealId) {
  const history = getRetargetHistoryForDeal(dealId);
  if (!history.length) return '';

  const statusColors = { exported: '#d97706', active: '#059669', replied: '#2563eb', no_response: '#6b7280' };

  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
    <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Retarget History (${history.length})</div>
    ${history.map(h => {
      const date = h.exportedAt ? new Date(h.exportedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
      const color = statusColors[h.status] || '#6b7280';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px">
        <span>${esc(h.campaignName || '—')} · ${date}</span>
        <span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${color}15;color:${color}">${esc(h.status)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── CSV Export ───

export function exportRetargetCSV(exportId) {
  const exp = state.retargetExports.find(e => String(e.id) === String(exportId));
  if (!exp || !exp.payload) return;
  const payload = typeof exp.payload === 'string' ? JSON.parse(exp.payload) : exp.payload;
  const allLeads = payload.segments.flatMap(s => s.leads.map(l => ({ ...l, segment: s.type })));

  const headers = ['email', 'first_name', 'last_name', 'company', 'phone', 'linkedin_url', 'location', 'job_title', 'original_campaign', 'original_stage', 'segment'];
  let csv = headers.join(',') + '\n';
  for (const lead of allLeads) {
    csv += headers.map(h => '"' + String(lead[h] || '').replace(/"/g, '""') + '"').join(',') + '\n';
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retarget_${(exp.campaignName || 'export').replace(/\s+/g, '_').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Window exposures ───
window.openRetargetBuilder = openRetargetBuilder;
window.closeRetargetBuilder = closeRetargetBuilder;
window.nextRetargetStep = nextRetargetStep;
window.prevRetargetStep = prevRetargetStep;
window.setRetargetFilter = setRetargetFilter;
window.toggleRetargetSelect = toggleRetargetSelect;
window.toggleRetargetSelectAll = toggleRetargetSelectAll;
window.runRetargetValidation = runRetargetValidation;
window.executeRetargetExport = executeRetargetExport;
window.downloadRetargetExport = downloadRetargetExport;
window.markRetargetActive = markRetargetActive;
window.markRetargetComplete = markRetargetComplete;
window.exportRetargetCSV = exportRetargetCSV;
