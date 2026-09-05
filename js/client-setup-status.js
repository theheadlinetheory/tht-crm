// ═══════════════════════════════════════════════════════════
// CLIENT-SETUP-STATUS — onboarding pieces a client is still missing
// ═══════════════════════════════════════════════════════════
// The Won modal creates the client record and clears the deal out of the
// pipeline immediately after, so the pieces that follow it (Lead Tracker sheet,
// Smartlead portal) can fail without stranding the card in Acquisition. This is
// where that failure becomes visible again: a badge on the collapsed client row
// in Settings, and a banner inside the card pointing at the buttons that already
// exist for each piece.
//
// Only DB-backed pieces are listed. Smartlead tags leave no column to check, and
// the tag function fuzzy-matches before creating, so re-running it is harmless.
import { str } from './utils.js?v=20260905053949';

// Each gap names the button further down the client card that fixes it.
export function setupGaps(client) {
  const gaps = [];
  if (!str(client.clientSheetId).trim()) gaps.push({ label: 'Lead Tracker sheet', fix: 'Create Lead Tracker' });
  if (!str(client.smartleadClientId).trim()) gaps.push({ label: 'Smartlead portal', fix: 'Create portal' });
  return gaps;
}

// Sits in the collapsed accordion header so an unfinished onboarding is visible
// without opening every client.
export function setupBadge(client) {
  const n = setupGaps(client).length;
  if (!n) return '';
  return `<span title="Onboarding incomplete" style="padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;white-space:nowrap">Setup ${n}</span>`;
}

export function setupBanner(client) {
  const gaps = setupGaps(client);
  if (!gaps.length) return '';
  const rows = gaps.map(g => `<li>${g.label} — use <strong>${g.fix}</strong> below</li>`).join('');
  return `<div style="margin-bottom:10px;padding:10px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e">
    <div style="font-weight:700;margin-bottom:4px">Onboarding incomplete</div>
    <ul style="margin:0;padding-left:16px">${rows}</ul>
  </div>`;
}
