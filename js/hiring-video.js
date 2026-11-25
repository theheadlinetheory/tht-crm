// ═══════════════════════════════════════════════════════════
// HIRING VIDEO — the applicant's intro video as one bold button (Aidan,
// 2026-11-16): the host's own logo when it's Loom or Google Drive, a plain ▶
// for anything else. Marks from Simple Icons (simple-icons@13.21.0, CC0).
// ═══════════════════════════════════════════════════════════
import { escAttr, safeUrl } from './utils.js?v=20261125104050';
import { withScheme } from './hiring-modal.js?v=20261125104050';

const mark = (color, d, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="flex-shrink:0"><path fill="${color}" d="${d}"/></svg>`;
const HOSTS = [
  { test: /loom\.com/i, label: 'Loom', color: '#625DF5', bg: '#f0efff',
    d: 'M24 10.665h-7.018l6.078-3.509-1.335-2.312-6.078 3.509 3.508-6.077L16.843.94l-3.508 6.077V0h-2.67v7.018L7.156.94 4.844 2.275l3.509 6.077-6.078-3.508L.94 7.156l6.078 3.509H0v2.67h7.017L.94 16.844l1.335 2.313 6.077-3.508-3.509 6.077 2.312 1.335 3.509-6.078V24h2.67v-7.017l3.508 6.077 2.312-1.335-3.509-6.078 6.078 3.509 1.335-2.313-6.077-3.508h7.017v-2.67H24zm-12 4.966a3.645 3.645 0 1 1 0-7.29 3.645 3.645 0 0 1 0 7.29z' },
  { test: /drive\.google\.com|docs\.google\.com/i, label: 'Google Drive', color: '#1a73e8', bg: '#e8f0fe',
    d: 'M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z' },
];
const OTHER = { label: 'video', color: '#111827', bg: '#f3f4f6' };

// big = the card modal's button; otherwise the board card / list size.
export function videoButtonHtml(url, big = false) {
  const href = safeUrl(withScheme(String(url || '').trim()));
  if (!url || !href) return '';
  const host = HOSTS.find(h => h.test.test(href)) || OTHER;
  const size = big ? 18 : 14;
  const icon = host.d ? mark(host.color, host.d, size) : `<span style="font-size:${size - 2}px">▶</span>`;
  return `<a href="${escAttr(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
    style="display:inline-flex;align-items:center;gap:6px;font-weight:800;text-decoration:none;color:${host.color};background:${host.bg};border:1.5px solid ${host.color}55;border-radius:8px;padding:${big ? '8px 14px' : '4px 10px'};font-size:${big ? 14 : 12}px">
    ${icon}Watch ${host.label === 'video' ? 'video' : `on ${host.label}`}</a>`;
}
