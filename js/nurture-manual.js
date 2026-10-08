// ═══════════════════════════════════════════════════════════
// NURTURE → MANUAL — reactivation worked by hand
// ═══════════════════════════════════════════════════════════
// The other half of Nurture → Automated. Everyone needsManualOutreach() keeps
// (held or missed a demo, held a disco, or owned by MANUAL_OUTREACH_OWNER),
// plus the deals already re-activated and mid-cadence. Actions reuse the
// nurture handlers in rerun.js — this file only lays the list out.
import { state } from './app.js?v=20261008155335';
import { esc, getToday, fmtDate, svgIcon } from './utils.js?v=20261008155335';
import { statCard } from './html-helpers.js?v=20261008155335';
import { getNurtureItems, needsManualOutreach, getUrgencyBadge, ownerChip, demoHeldChip } from './rerun.js?v=20261008155335';
import { journeyFor } from './archive-journey.js?v=20261008155335';

const BTN = 'font-size:10px;padding:2px 8px;border-radius:4px';
const CALL_BTN = `${BTN};background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;text-decoration:none;display:inline-flex;align-items:center;gap:2px`;

function dealFor(dealId) {
  return state.deals.find(d => String(d.id) === String(dealId));
}

function callButton(deal) {
  const phone = deal?.phone || deal?.mobilePhone || '';
  return phone ? `<a href="tel:${esc(phone)}" class="btn" style="${CALL_BTN}" title="Call ${esc(phone)}">${svgIcon('phone', 10)} Call</a>` : '';
}

// What the last meeting was, so the context is there before the call:
// "Demo · Showed · Sep 12", falling back to the funnel ledger for disco-only leads.
function meetingCell(dealId) {
  const entry = state.demoEntries
    .filter(e => String(e.dealId) === String(dealId) && /^(Showed|No-Show)/.test(e.showStatus || ''))
    .sort((a, b) => String(b.callDate || '').localeCompare(String(a.callDate || '')))[0];
  if (entry) {
    const when = entry.callDate ? ` · ${fmtDate(entry.callDate)}` : '';
    const color = entry.showStatus.startsWith('Showed') ? '#6d28d9' : '#dc2626';
    return `<span style="font-weight:600;color:${color}" title="${esc(entry.notes || '')}">${esc(entry.callType || 'Demo')} · ${esc(entry.showStatus)}${esc(when)}</span>`;
  }
  const j = journeyFor(dealId);
  return j.hadMeeting ? esc(j.leftAt) : '<span style="color:var(--text-muted)">—</span>';
}

function nextTask(dealId) {
  const open = state.activities
    .filter(a => String(a.dealId) === String(dealId) && !a.done)
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  return open[0] || null;
}

function sectionHeader(title, count, hint) {
  return `<div style="display:flex;align-items:baseline;gap:8px;margin:20px 0 8px">
    <h4 style="font-size:13px;font-weight:700;color:var(--text-primary);margin:0">${title} (${count})</h4>
    <span style="font-size:11px;color:var(--text-muted)">${hint}</span>
  </div>`;
}

function inProgressTable(deals, today) {
  if (!deals.length) return `<div class="rerun-empty" style="padding:16px">Nothing being re-activated right now.</div>`;
  const rows = deals.map(deal => {
    const task = nextTask(deal.id);
    const badge = task ? getUrgencyBadge(task.dueDate, today) : null;
    return `<tr>
      <td style="font-weight:600;cursor:pointer" data-action="openNurtureDeal" data-id="${esc(deal.id)}">${esc(deal.company || deal.contact || '')}${demoHeldChip(deal.id)}</td>
      <td>${meetingCell(deal.id)}</td>
      <td>${task ? `${esc(task.type)}: ${esc(task.subject)}` : '<span style="color:#dc2626;font-weight:600">No open tasks</span>'}</td>
      <td>${task ? `<span style="font-size:11px;font-weight:600;color:${badge.color}">${esc(task.dueDate ? fmtDate(task.dueDate) : '-')}${badge.label && badge.label !== 'Upcoming' ? ` · ${esc(badge.label)}` : ''}</span>` : ''}</td>
      <td>${ownerChip(deal, deal.id)}</td>
      <td style="white-space:nowrap">${callButton(deal)}
        <button class="btn" style="${BTN};background:#f3f4f6;color:#374151;border:1px solid #d1d5db" data-action="openNurtureDeal" data-id="${esc(deal.id)}">Open</button></td>
    </tr>`;
  }).join('');
  return `<table class="rerun-table"><thead><tr>
    <th>Company</th><th>Last meeting</th><th>Next task</th><th>Due</th><th>Owner</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function nurtureTable(items, today, empty) {
  if (!items.length) return `<div class="rerun-empty" style="padding:16px">${empty}</div>`;
  const rows = items.map(r => {
    const deal = dealFor(r.dealId);
    const badge = getUrgencyBadge(r.followUpDate, today);
    return `<tr>
      <td style="font-weight:600;cursor:pointer" data-action="openNurtureDeal" data-id="${esc(r.dealId)}">${esc(r.dealName || r.company || '')}${demoHeldChip(r.dealId)}</td>
      <td>${meetingCell(r.dealId)}</td>
      <td><span style="font-weight:600">${esc(r.followUpDate ? fmtDate(r.followUpDate) : 'No date')}</span>${badge.label && badge.label !== 'Upcoming' ? `<div style="font-size:10px;font-weight:700;color:${badge.color}">${esc(badge.label)}</div>` : ''}</td>
      <td style="color:var(--text-muted);font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes || '')}">${esc(r.notes || '')}</td>
      <td>${ownerChip(deal, r.dealId)}</td>
      <td style="white-space:nowrap">${callButton(deal)}
        <button class="btn" style="${BTN};background:#ede9fe;color:#7c3aed;border:1px solid #c4b5fd" data-action="reactivateNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Re-activate</button>
        <button class="btn" style="${BTN};background:#fef3c7;color:#d97706;border:1px solid #fde68a" data-action="snoozeNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Snooze</button>
        <button class="btn" style="${BTN};background:#fef2f2;color:#dc2626;border:1px solid #fecaca" data-action="archiveNurtureDeal" data-id="${esc(r.id)}" data-deal-id="${esc(r.dealId)}">Archive</button></td>
    </tr>`;
  }).join('');
  return `<table class="rerun-table"><thead><tr>
    <th>Company</th><th>Last meeting</th><th>Follow-up</th><th>Note</th><th>Owner</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderManualReactivation() {
  if (state.rerunLoading) return `<div class="rerun-empty">Loading nurture data...</div>`;

  const today = getToday();
  const byDate = (a, b) => String(a.followUpDate || '9999').localeCompare(String(b.followUpDate || '9999'));
  const manual = getNurtureItems('not_now').filter(needsManualOutreach);
  const due = manual.filter(r => r.followUpDate && r.followUpDate <= today).sort(byDate);
  const later = manual.filter(r => !(r.followUpDate && r.followUpDate <= today)).sort(byDate);
  const inProgress = state.deals.filter(d => d.pipeline === 'Acquisition' && d.stage === 'Reactivating');

  return `<div class="rerun-stat-cards">
      ${statCard('In progress', inProgress.length, '#f59e0b')}
      ${statCard('Due', due.length, '#dc2626')}
      ${statCard('Waiting', later.length, '#6b7280')}
    </div>
    ${sectionHeader('In progress', inProgress.length, 'Re-activated — work the Day 1–3 tasks')}
    ${inProgressTable(inProgress, today)}
    ${sectionHeader('Due', due.length, 'Follow-up date reached — call, then Re-activate or Snooze')}
    ${nurtureTable(due, today, 'Nobody due today.')}
    ${sectionHeader('Waiting', later.length, 'Comes due on its follow-up date')}
    ${nurtureTable(later, today, 'Nobody waiting.')}`;
}
