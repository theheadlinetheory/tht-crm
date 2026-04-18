// ═══════════════════════════════════════════════════════════
// NURTURE — Two-bucket nurture pipeline (Not Now + Service Area Taken)
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites } from './app.js';
import { render } from './render.js';
import { sbGetRerunQueue, sbAddToRerun, sbUpdateRerunItem, sbUpdateRerunStatus, sbUpdateDeal, camelToSnake, normalizeRow } from './api.js';
import { esc, str, getToday, fmtDate, svgIcon, uid } from './utils.js';
import { registerActions } from './delegate.js';
import { statCard, filterSelect, modalWrap, modalHeader, modalFooter } from './html-helpers.js';
import { findClientForDeal } from './client-info.js';
import { NURTURE_NOT_NOW_SEQUENCE, ACQUISITION_STAGES } from './config.js';
import { isAdmin } from './auth.js';

// ─── Data Loading ───

export async function loadNurtureData() {
  state.rerunLoading = true;
  render();
  try {
    const queue = await sbGetRerunQueue();
    if (Array.isArray(queue)) state.rerunQueue = queue.map(normalizeRow);
  } catch (e) { console.warn('Failed to load nurture data:', e); }
  state.rerunLoading = false;
  render();
}

// ─── Filter / Helper Functions ───

export function getNurtureItems(bucket) {
  return state.rerunQueue.filter(r =>
    (r.status || '').toLowerCase() === 'active' &&
    (r.bucket || '').toLowerCase() === bucket.toLowerCase()
  );
}

export function getFilteredNurtureItems() {
  let items = state.rerunQueue.filter(r => (r.status || '').toLowerCase() === 'active');
  if (state.nurtureFilterBucket) {
    items = items.filter(r => (r.bucket || '').toLowerCase() === state.nurtureFilterBucket.toLowerCase());
  }
  if (state.nurtureFilterCampaign) {
    items = items.filter(r => r.campaignName === state.nurtureFilterCampaign);
  }
  return items;
}

export function getNurtureCampaigns() {
  const campaigns = new Set();
  state.rerunQueue.forEach(r => {
    if ((r.status || '').toLowerCase() === 'active' && r.campaignName) {
      campaigns.add(r.campaignName);
    }
  });
  return [...campaigns].sort();
}

export function getDueNurtureItems() {
  const today = getToday();
  return getNurtureItems('not_now').filter(r => r.followUpDate && r.followUpDate <= today);
}

export function getOverdueNurtureItems() {
  const today = getToday();
  return getNurtureItems('not_now').filter(r => r.followUpDate && r.followUpDate < today);
}

// ─── Core Functions ───

export async function updateNurtureStatus(id, newStatus) {
  const item = state.rerunQueue.find(r => r.id === id);
  if (item) item.status = newStatus;
  render();
  pendingWrites.value++;
  try { await sbUpdateRerunStatus(id, newStatus); }
  finally { pendingWrites.value--; }
}

export async function addToNurture(dealId, bucket, followUpDate, note) {
  const deal = state.deals.find(d => String(d.id) === String(dealId));
  if (!deal) return null;

  // Check for existing nurture entry for this deal
  const existing = state.rerunQueue.find(r => String(r.dealId) === String(dealId) && (r.status || '').toLowerCase() === 'active');
  if (existing) {
    // Update existing entry
    existing.bucket = bucket;
    existing.followUpDate = followUpDate || '';
    existing.notes = note || '';
    existing.status = 'active';
    render();
    pendingWrites.value++;
    try {
      await sbUpdateRerunItem(existing.id, camelToSnake({
        bucket,
        followUpDate: followUpDate || null,
        notes: note || '',
        status: 'active'
      }));
    } finally { pendingWrites.value--; }
    return existing;
  }

  // Create new entry
  const data = {
    dealId: deal.id,
    dealName: deal.company || deal.contact || 'Unknown',
    email: deal.email || '',
    location: deal.location || '',
    state: deal.state || '',
    city: deal.city || '',
    campaignName: deal.campaignName || '',
    stage: deal.stage || '',
    bucket,
    followUpDate: followUpDate || null,
    notes: note || '',
    status: 'active'
  };

  pendingWrites.value++;
  try {
    const resp = await sbAddToRerun(camelToSnake(data));
    if (resp && resp.id) {
      const newItem = { ...data, id: resp.id, queuedAt: new Date().toISOString() };
      store.addRerunItem(newItem, { silent: true });
      return newItem;
    }
  } finally { pendingWrites.value--; }
  return null;
}

export function createNurtureSequence(dealId, followUpDate) {
  if (!window.addActivity) return;
  const baseDate = followUpDate ? new Date(followUpDate + 'T00:00:00') : new Date();
  for (const step of NURTURE_NOT_NOW_SEQUENCE) {
    const dueDate = new Date(baseDate);
    dueDate.setDate(dueDate.getDate() + step.dayOffset);
    const dueDateStr = dueDate.getFullYear() + '-' +
      String(dueDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(dueDate.getDate()).padStart(2, '0');
    window.addActivity(dealId, {
      type: step.type,
      subject: step.subject,
      dueDate: dueDateStr,
      dayLabel: 'Nurture'
    });
  }
}

export function clearDealActivities(dealId) {
  const now = new Date().toISOString();
  const activities = state.activities.filter(a =>
    String(a.dealId) === String(dealId) && !a.done
  );
  for (const act of activities) {
    act.done = true;
    act.completedAt = now;
    import('./api.js').then(({ sbUpdateActivity, camelToSnake: c2s }) => {
      sbUpdateActivity(act.id, c2s({ done: true, completedAt: now }));
    });
  }
}

// ─── CSV Export ───

export function exportNurtureForSmartlead() {
  if (!isAdmin()) return;
  const items = getNurtureItems('service_area_taken');
  if (!items.length) { alert('No Service Area Taken items to export.'); return; }

  const headers = ['email', 'first_name', 'last_name', 'company_name', 'website', 'location', 'custom1', 'custom2'];
  const rows = items.map(r => {
    const nameParts = (r.dealName || '').split(' ');
    return [
      r.email || '', nameParts[0] || '', nameParts.slice(1).join(' ') || '',
      r.dealName || '', '', r.location || '', r.campaignName || '', r.stage || ''
    ];
  });

  let csv = headers.join(',') + '\n';
  for (const row of rows) {
    csv += row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',') + '\n';
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'nurture_sat_smartlead.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ─── Due Today Banner (Acquisition Pipeline) ───

export function renderDueTodayBanner() {
  const dueItems = getDueNurtureItems();
  if (!dueItems.length) return '';

  const today = getToday();
  let h = `<div class="nurture-banner" style="margin-bottom:16px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
    <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#92400e">${svgIcon('bell', 14)} Nurture Follow-ups Due (${dueItems.length})</div>`;

  for (const item of dueItems) {
    const followUp = item.followUpDate || '';
    let urgencyLabel = 'Due today';
    let urgencyColor = '#d97706'; // yellow-ish for today

    if (followUp < today) {
      const diffMs = new Date(today + 'T00:00:00') - new Date(followUp + 'T00:00:00');
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffDays <= 3) {
        urgencyLabel = `${diffDays}d overdue`;
        urgencyColor = '#ea580c'; // orange
      } else {
        urgencyLabel = `${diffDays}d overdue`;
        urgencyColor = '#dc2626'; // red
      }
    }

    // Find first incomplete nurture activity for this deal
    const dealActivities = state.activities.filter(a =>
      String(a.dealId) === String(item.dealId) && !a.done && (a.dayLabel || '').toLowerCase() === 'nurture'
    );
    const nextTask = dealActivities.length > 0
      ? `${dealActivities[0].type}: ${dealActivities[0].subject}`
      : 'Re-engagement follow-up';

    h += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #fde68a">
      <span style="font-size:10px;font-weight:700;color:${urgencyColor};min-width:80px">${esc(urgencyLabel)}</span>
      <span style="font-weight:600;font-size:12px;flex:1;cursor:pointer" data-action="openNurtureDeal" data-id="${esc(item.dealId)}">${esc(item.dealName || 'Unknown')}</span>
      <span style="font-size:11px;color:var(--text-muted)">${esc(nextTask)}</span>
      <span style="font-size:10px;color:var(--text-muted)">${esc(item.campaignName || '')}</span>
      <div style="display:flex;gap:4px">
        <button class="btn" style="font-size:10px;padding:2px 8px;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0" data-action="completeNurtureActivity" data-deal-id="${esc(item.dealId)}" title="Complete activity">${svgIcon('check', 10)}</button>
        <button class="btn" style="font-size:10px;padding:2px 8px;background:#fef3c7;color:#d97706;border:1px solid #fde68a" data-action="snoozeNurtureDeal" data-id="${esc(item.id)}" data-deal-id="${esc(item.dealId)}" title="Snooze">${svgIcon('clock', 10)}</button>
        <button class="btn" style="font-size:10px;padding:2px 8px;background:#ede9fe;color:#7c3aed;border:1px solid #c4b5fd" data-action="reactivateNurtureDeal" data-id="${esc(item.id)}" data-deal-id="${esc(item.dealId)}" title="Re-activate">${svgIcon('refresh', 10)}</button>
      </div>
    </div>`;
  }

  h += `</div>`;
  return h;
}

// ─── Main Nurture Tab ───

export function renderNurtureTab() {
  const notNowItems = getFilteredNurtureItems().filter(r => (r.bucket || '').toLowerCase() === 'not_now');
  const satItems = getFilteredNurtureItems().filter(r => (r.bucket || '').toLowerCase() === 'service_area_taken');
  const campaigns = getNurtureCampaigns();
  const totalNotNow = getNurtureItems('not_now').length;
  const totalSAT = getNurtureItems('service_area_taken').length;
  const totalDue = getDueNurtureItems().length;
  const totalOverdue = getOverdueNurtureItems().length;

  let h = `<div class="rerun-container">
    <div class="rerun-stat-cards">
      ${statCard('Not Now', totalNotNow, '#d97706')}
      ${statCard('Service Area Taken', totalSAT, '#f97316')}
      ${statCard('Due Today', totalDue, '#2563eb')}
      ${statCard('Overdue', totalOverdue, '#dc2626')}
    </div>

    <div class="rerun-filters">
      ${filterSelect('nurtureFilterCampaign', 'All Campaigns', campaigns, state.nurtureFilterCampaign)}
      ${filterSelect('nurtureFilterBucket', 'All Buckets', ['not_now', 'service_area_taken'], state.nurtureFilterBucket)}
      <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${notNowItems.length + satItems.length} active items</span>
    </div>`;

  if (state.rerunLoading) {
    h += `<div class="rerun-empty">Loading nurture data...</div>`;
  } else {
    // ── Not Now Section ──
    h += `<div style="margin-top:20px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-primary)">Not Now (${notNowItems.length})</h4>`;

    if (notNowItems.length === 0) {
      h += `<div class="rerun-empty" style="padding:16px">No &ldquo;Not Now&rdquo; items.</div>`;
    } else {
      h += `<table class="rerun-table">
        <thead><tr>
          <th>Company</th><th>Contact</th><th>Campaign / Market</th><th>Follow-up Date</th><th>Status</th><th>Note</th><th></th>
        </tr></thead><tbody>`;

      const today = getToday();
      for (const r of notNowItems) {
        const followUp = r.followUpDate || '';
        let statusLabel = 'Scheduled';
        let statusColor = '#6b7280';
        if (followUp && followUp <= today) {
          const diffMs = new Date(today + 'T00:00:00') - new Date(followUp + 'T00:00:00');
          const diffDays = Math.floor(diffMs / 86400000);
          if (diffDays === 0) { statusLabel = 'Due today'; statusColor = '#d97706'; }
          else if (diffDays <= 3) { statusLabel = `${diffDays}d overdue`; statusColor = '#ea580c'; }
          else { statusLabel = `${diffDays}d overdue`; statusColor = '#dc2626'; }
        }

        h += `<tr>
          <td style="font-weight:600;cursor:pointer" data-action="openNurtureDeal" data-id="${esc(r.dealId)}">${esc(r.dealName || r.company || '')}</td>
          <td style="color:var(--text-muted)">${esc(r.email || '')}</td>
          <td>${esc(r.campaignName || '')}</td>
          <td style="font-weight:600">${esc(followUp ? fmtDate(followUp) : '-')}</td>
          <td><span style="font-size:11px;font-weight:600;color:${statusColor}">${statusLabel}</span></td>
          <td style="color:var(--text-muted);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes || '')}">${esc(r.notes || '')}</td>
          <td style="white-space:nowrap">
            <button class="btn" style="font-size:10px;padding:2px 8px;background:#ede9fe;color:#7c3aed;border:1px solid #c4b5fd" data-action="reactivateNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Re-activate</button>
            <button class="btn" style="font-size:10px;padding:2px 8px;background:#fef3c7;color:#d97706;border:1px solid #fde68a" data-action="snoozeNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Snooze</button>
            <button class="btn" style="font-size:10px;padding:2px 8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca" data-action="archiveNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Archive</button>
          </td>
        </tr>`;
      }
      h += `</tbody></table>`;
    }
    h += `</div>`;

    // ── Service Area Taken Section ──
    h += `<div style="margin-top:24px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h4 style="font-size:13px;font-weight:700;color:var(--text-primary);margin:0">Service Area Taken (${satItems.length})</h4>
        ${isAdmin() ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 10px;background:#ecfdf5;color:var(--purple);border:1px solid #a7f3d0" data-action="exportNurtureSmartlead">${svgIcon('upload', 10)} Export for SmartLead</button>` : ''}
      </div>`;

    if (satItems.length === 0) {
      h += `<div class="rerun-empty" style="padding:16px">No &ldquo;Service Area Taken&rdquo; items.</div>`;
    } else {
      const allSelected = state.satSelectAll || (satItems.length > 0 && satItems.every(r => state.satSelected.has(r.id)));

      h += `<table class="rerun-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" data-action="toggleAllSAT" ${allSelected ? 'checked' : ''}></th>
          <th>Company</th><th>Contact</th><th>Campaign / Market</th><th>Date Added</th><th>Note</th><th></th>
        </tr></thead><tbody>`;

      for (const r of satItems) {
        const checked = state.satSelected.has(r.id);
        h += `<tr>
          <td><input type="checkbox" data-action="toggleSATSelect" data-id="${esc(r.id)}" ${checked ? 'checked' : ''}></td>
          <td style="font-weight:600;cursor:pointer" data-action="openNurtureDeal" data-id="${esc(r.dealId)}">${esc(r.dealName || r.company || '')}</td>
          <td style="color:var(--text-muted)">${esc(r.email || '')}</td>
          <td>${esc(r.campaignName || '')}</td>
          <td style="color:var(--text-muted)">${esc(r.queuedAt ? fmtDate(r.queuedAt.split('T')[0]) : '-')}</td>
          <td style="color:var(--text-muted);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes || '')}">${esc(r.notes || '')}</td>
          <td style="white-space:nowrap">
            <button class="btn" style="font-size:10px;padding:2px 8px;background:#ede9fe;color:#7c3aed;border:1px solid #c4b5fd" data-action="reactivateNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Re-activate</button>
            <button class="btn" style="font-size:10px;padding:2px 8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca" data-action="archiveNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Archive</button>
          </td>
        </tr>`;
      }
      h += `</tbody></table>`;

      // Bulk action bar
      if (state.satSelected.size > 0) {
        h += `<div style="margin-top:8px;padding:8px 12px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;font-weight:600;color:#7c3aed">${state.satSelected.size} selected</span>
          <button class="btn" style="font-size:10px;padding:3px 10px;background:#7c3aed;color:#fff;border:none;border-radius:4px" data-action="bulkReactivateSAT">Re-activate Selected</button>
        </div>`;
      }
    }
    h += `</div>`;
  }

  h += `</div>`;

  // Modals
  if (state._showNurtureEntryModal) {
    h += renderNurtureEntryModal(state._nurtureEntryDealId);
  }
  if (state._showReactivateModal) {
    h += renderReactivateModal(state._reactivateNurtureId, state._reactivateDealId);
  }
  if (state._showSnoozeModal) {
    h += renderSnoozeModal(state._snoozeNurtureId, state._snoozeDealId);
  }

  return h;
}

// ─── Nurture Entry Modal ───

export function renderNurtureEntryModal(dealId) {
  const deal = state.deals.find(d => String(d.id) === String(dealId));
  const dealName = deal ? (deal.company || deal.contact || 'Unknown') : 'Unknown';
  const defaultDate = new Date(Date.now() + 30 * 86400000);
  const defaultDateStr = defaultDate.getFullYear() + '-' +
    String(defaultDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(defaultDate.getDate()).padStart(2, '0');
  const selectedBucket = state._nurtureEntryBucket || 'not_now';
  const showDate = selectedBucket === 'not_now';

  let body = modalHeader('Move to Nurture', 'closeNurtureModal');
  body += `<div class="modal-body">
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Moving <strong>${esc(dealName)}</strong> to the Nurture pipeline.</p>

    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Bucket</label>
      <select data-action="nurtureBucketChange" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <option value="not_now" ${selectedBucket === 'not_now' ? 'selected' : ''}>Not Now</option>
        <option value="service_area_taken" ${selectedBucket === 'service_area_taken' ? 'selected' : ''}>Service Area Taken</option>
      </select>
    </div>

    <div id="nurture-date-row" style="margin-bottom:12px;${showDate ? '' : 'display:none'}">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Follow-up Date</label>
      <input type="date" id="nurture-follow-up-date" value="${defaultDateStr}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    </div>

    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Note (optional)</label>
      <input type="text" id="nurture-note" placeholder="Reason for nurturing..." style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    </div>
  </div>`;
  body += modalFooter('closeNurtureModal', 'confirmNurtureEntry', 'Move to Nurture');
  return modalWrap(body, { closeAction: 'dismissNurtureModal', width: '460px' });
}

// ─── Reactivate Modal ───

export function renderReactivateModal(nurtureId, dealId) {
  let body = modalHeader('Re-activate Deal', 'closeReactivateModal');
  body += `<div class="modal-body">
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Choose which Acquisition stage to return this deal to.</p>
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Stage</label>
      <select id="reactivate-stage" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        ${ACQUISITION_STAGES.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}
      </select>
    </div>
  </div>`;
  body += modalFooter('closeReactivateModal', 'confirmReactivate', 'Re-activate');
  return modalWrap(body, { closeAction: 'dismissReactivateModal', width: '460px' });
}

// ─── Snooze Modal ───

export function renderSnoozeModal(nurtureId, dealId) {
  const defaultDate = new Date(Date.now() + 30 * 86400000);
  const defaultDateStr = defaultDate.getFullYear() + '-' +
    String(defaultDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(defaultDate.getDate()).padStart(2, '0');

  let body = modalHeader('Snooze Follow-up', 'closeSnoozeModal');
  body += `<div class="modal-body">
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Set a new follow-up date for this nurture item.</p>
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">New Follow-up Date</label>
      <input type="date" id="snooze-date" value="${defaultDateStr}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    </div>
  </div>`;
  body += modalFooter('closeSnoozeModal', 'confirmSnooze', 'Snooze');
  return modalWrap(body, { closeAction: 'dismissSnoozeModal', width: '400px' });
}

// ─── Event Delegation Handlers ───

registerActions({
  // Filters
  nurtureFilterCampaign(el) {
    state.nurtureFilterCampaign = el.value;
    render();
  },
  nurtureFilterBucket(el) {
    state.nurtureFilterBucket = el.value;
    render();
  },

  // Bucket change in entry modal
  nurtureBucketChange(el) {
    state._nurtureEntryBucket = el.value;
    const dateRow = document.getElementById('nurture-date-row');
    if (dateRow) dateRow.style.display = el.value === 'not_now' ? '' : 'none';
  },

  // Nurture entry modal
  closeNurtureModal() {
    state._showNurtureEntryModal = false;
    state._nurtureEntryDealId = null;
    state._nurtureEntryBucket = null;
    render();
  },
  dismissNurtureModal(el, e) {
    if (e.target === el) {
      state._showNurtureEntryModal = false;
      state._nurtureEntryDealId = null;
      state._nurtureEntryBucket = null;
      render();
    }
  },
  async confirmNurtureEntry() {
    const dealId = state._nurtureEntryDealId;
    if (!dealId) return;

    const bucketEl = document.querySelector('[data-action="nurtureBucketChange"]');
    const bucket = bucketEl ? bucketEl.value : (state._nurtureEntryBucket || 'not_now');
    const dateEl = document.getElementById('nurture-follow-up-date');
    const followUpDate = bucket === 'not_now' && dateEl ? dateEl.value : '';
    const noteEl = document.getElementById('nurture-note');
    const note = noteEl ? noteEl.value : '';

    // Close modal
    state._showNurtureEntryModal = false;
    state._nurtureEntryDealId = null;
    state._nurtureEntryBucket = null;

    // Update deal pipeline/stage to Nurture
    const deal = state.deals.find(d => String(d.id) === String(dealId));
    if (deal) {
      const nurtureStage = bucket === 'not_now' ? 'Not Now' : 'Service Area Taken';
      deal.pipeline = 'Nurture';
      deal.stage = nurtureStage;
      render();

      pendingWrites.value++;
      sbUpdateDeal(dealId, camelToSnake({ pipeline: 'Nurture', stage: nurtureStage }))
        .catch(e => console.error('Failed to update deal pipeline:', e))
        .finally(() => { pendingWrites.value--; });
    }

    // Clear existing activities for this deal
    clearDealActivities(dealId);

    // Add to nurture queue
    await addToNurture(dealId, bucket, followUpDate, note);

    // Create nurture sequence for not_now items
    if (bucket === 'not_now' && followUpDate) {
      createNurtureSequence(dealId, followUpDate);
    }

    render();
  },

  // Open deal modal
  openNurtureDeal(el) {
    if (window.openDeal) window.openDeal(el.dataset.id);
  },

  // Complete nurture activity
  completeNurtureActivity(el) {
    const dealId = el.dataset.dealId;
    const activities = state.activities.filter(a =>
      String(a.dealId) === String(dealId) && !a.done && (a.dayLabel || '').toLowerCase() === 'nurture'
    );
    if (activities.length > 0 && window.toggleActivity) {
      window.toggleActivity(activities[0].id);
    }
  },

  // Re-activate flow
  reactivateNurtureDeal(el) {
    state._showReactivateModal = true;
    state._reactivateNurtureId = el.dataset.id;
    state._reactivateDealId = el.dataset.dealId;
    render();
  },
  closeReactivateModal() {
    state._showReactivateModal = false;
    state._reactivateNurtureId = null;
    state._reactivateDealId = null;
    render();
  },
  dismissReactivateModal(el, e) {
    if (e.target === el) {
      state._showReactivateModal = false;
      state._reactivateNurtureId = null;
      state._reactivateDealId = null;
      render();
    }
  },
  async confirmReactivate() {
    const nurtureId = state._reactivateNurtureId;
    const dealId = state._reactivateDealId;
    if (!nurtureId || !dealId) return;

    const stageEl = document.getElementById('reactivate-stage');
    const stage = stageEl ? stageEl.value : 'Cold Email Response';

    state._showReactivateModal = false;
    state._reactivateNurtureId = null;
    state._reactivateDealId = null;

    if (nurtureId === '__bulk__') {
      // Bulk reactivate all selected SAT items
      const selectedIds = [...state.satSelected];
      state.satSelected.clear();
      state.satSelectAll = false;

      for (const id of selectedIds) {
        const item = state.rerunQueue.find(r => r.id === id);
        if (!item) continue;

        const deal = state.deals.find(d => String(d.id) === String(item.dealId));
        if (deal) {
          deal.pipeline = 'Acquisition';
          deal.stage = stage;
          pendingWrites.value++;
          sbUpdateDeal(deal.id, camelToSnake({ pipeline: 'Acquisition', stage }))
            .catch(e => console.error('Failed to re-activate deal:', e))
            .finally(() => { pendingWrites.value--; });
        }
        clearDealActivities(item.dealId);
        updateNurtureStatus(id, 'reactivated');
      }
      render();
      return;
    }

    // Single reactivate
    const deal = state.deals.find(d => String(d.id) === String(dealId));
    if (deal) {
      deal.pipeline = 'Acquisition';
      deal.stage = stage;
      render();

      pendingWrites.value++;
      sbUpdateDeal(dealId, camelToSnake({ pipeline: 'Acquisition', stage }))
        .catch(e => console.error('Failed to re-activate deal:', e))
        .finally(() => { pendingWrites.value--; });
    }

    clearDealActivities(dealId);
    await updateNurtureStatus(nurtureId, 'reactivated');
  },

  // Snooze flow
  snoozeNurtureDeal(el) {
    state._showSnoozeModal = true;
    state._snoozeNurtureId = el.dataset.id;
    state._snoozeDealId = el.dataset.dealId;
    render();
  },
  closeSnoozeModal() {
    state._showSnoozeModal = false;
    state._snoozeNurtureId = null;
    state._snoozeDealId = null;
    render();
  },
  dismissSnoozeModal(el, e) {
    if (e.target === el) {
      state._showSnoozeModal = false;
      state._snoozeNurtureId = null;
      state._snoozeDealId = null;
      render();
    }
  },
  async confirmSnooze() {
    const nurtureId = state._snoozeNurtureId;
    const dealId = state._snoozeDealId;
    if (!nurtureId || !dealId) return;

    const dateEl = document.getElementById('snooze-date');
    const newDate = dateEl ? dateEl.value : '';
    if (!newDate) { alert('Please select a date.'); return; }

    state._showSnoozeModal = false;
    state._snoozeNurtureId = null;
    state._snoozeDealId = null;

    // Clear existing nurture activities
    clearDealActivities(dealId);

    // Update follow-up date in nurture queue
    const item = state.rerunQueue.find(r => r.id === nurtureId);
    if (item) {
      item.followUpDate = newDate;
      render();

      pendingWrites.value++;
      sbUpdateRerunItem(nurtureId, camelToSnake({ followUpDate: newDate }))
        .catch(e => console.error('Failed to snooze:', e))
        .finally(() => { pendingWrites.value--; });
    }

    // Create new nurture sequence from new date
    createNurtureSequence(dealId, newDate);
    render();
  },

  // Archive
  async archiveNurtureDeal(el) {
    const nurtureId = el.dataset.id;
    const dealId = el.dataset.dealId;
    if (!confirm('Archive this deal? It will be removed from the nurture queue.')) return;

    // Update nurture status
    await updateNurtureStatus(nurtureId, 'archived');

    // Archive the deal
    const deal = state.deals.find(d => String(d.id) === String(dealId));
    if (deal) {
      const { sbArchiveDeal, sbDeleteDeal } = await import('./api.js');
      pendingWrites.value++;
      try {
        await sbArchiveDeal(deal.id, JSON.stringify(deal));
        await sbDeleteDeal(deal.id);
        store.removeDeal(deal.id, { silent: true });
      } catch (e) { console.error('Failed to archive deal:', e); }
      finally { pendingWrites.value--; }
    }

    render();
  },

  // SAT bulk selection
  toggleSATSelect(el) {
    const id = el.dataset.id;
    if (el.checked) {
      state.satSelected.add(id);
    } else {
      state.satSelected.delete(id);
      state.satSelectAll = false;
    }
    render();
  },
  toggleAllSAT(el) {
    const satItems = getFilteredNurtureItems().filter(r => (r.bucket || '').toLowerCase() === 'service_area_taken');
    if (el.checked) {
      state.satSelectAll = true;
      satItems.forEach(r => state.satSelected.add(r.id));
    } else {
      state.satSelectAll = false;
      state.satSelected.clear();
    }
    render();
  },
  bulkReactivateSAT() {
    if (state.satSelected.size === 0) return;
    // Open reactivate modal for bulk — use first selected as representative
    const firstId = [...state.satSelected][0];
    const item = state.rerunQueue.find(r => r.id === firstId);
    if (item) {
      state._showReactivateModal = true;
      state._reactivateNurtureId = '__bulk__';
      state._reactivateDealId = item.dealId;
      render();
    }
  },

  // SmartLead export
  exportNurtureSmartlead() {
    exportNurtureForSmartlead();
  },
});

// ─── Backward Compatibility ───
// deals.js still imports addToRerunQueue — alias to addToNurture with default bucket
export async function addToRerunQueue(dealId) {
  return addToNurture(dealId, 'not_now', '', '');
}

// ─── Window Exports ───
window.loadRerunData = loadNurtureData;
window.loadNurtureData = loadNurtureData;
