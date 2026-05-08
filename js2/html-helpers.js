// ═══════════════════════════════════════════════════════════
// HTML-HELPERS — Reusable HTML template builders (DRY)
// ═══════════════════════════════════════════════════════════
import { esc, svgIcon } from './utils.js';

/**
 * Wraps content in a modal overlay + modal container.
 * @param {string} body   - Inner HTML (header + body + footer)
 * @param {object} opts
 *   closeAction: data-action name for backdrop dismiss (default 'dismissOverlay')
 *   width:       CSS width string (default '520px')
 */
export function modalWrap(body, { closeAction = 'dismissOverlay', width = '520px' } = {}) {
  return `<div class="modal-overlay" data-action="${closeAction}">
    <div class="modal" style="width:${width}">${body}</div>
  </div>`;
}

/**
 * Standard modal header with title and close button.
 * @param {string} title       - Title text (already escaped)
 * @param {string} closeAction - data-action for close button
 * @param {string} icon        - Optional SVG icon HTML
 */
export function modalHeader(title, closeAction = 'dismissOverlay', icon = '') {
  return `<div class="modal-header">
    <h3>${icon}${title}</h3>
    <button class="modal-close" data-action="${closeAction}">\u00D7</button>
  </div>`;
}

/**
 * Standard modal footer with Cancel + primary action button.
 * @param {string} cancelAction - data-action for cancel
 * @param {string} saveAction   - data-action for primary button
 * @param {string} saveLabel    - Primary button text (default 'Save')
 */
export function modalFooter(cancelAction, saveAction, saveLabel = 'Save') {
  return `<div class="modal-footer" style="justify-content:flex-end;gap:8px">
    <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" data-action="${cancelAction}">Cancel</button>
    <button class="btn btn-primary" data-action="${saveAction}">${saveLabel}</button>
  </div>`;
}

/**
 * Filter dropdown select.
 * @param {string} action      - data-action name
 * @param {string} placeholder - Default option text (e.g. "All States")
 * @param {string[]} options   - Array of option values
 * @param {string} selected    - Currently selected value
 * @param {string} style       - Optional additional inline styles
 */
export function filterSelect(action, placeholder, options, selected = '', style = '') {
  const baseStyle = 'padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font)';
  return `<select data-action="${action}" style="${baseStyle};${style}">
    <option value="">${esc(placeholder)}</option>
    ${options.map(o => `<option value="${esc(o)}" ${selected === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
  </select>`;
}

/**
 * Stat card for dashboards / summary panels.
 * @param {string} label - Card label
 * @param {string|number} value - Display value
 * @param {string} color - Value color (optional)
 */
export function statCard(label, value, color = '') {
  const colorStyle = color ? ` style="color:${color}"` : '';
  return `<div class="rerun-stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value"${colorStyle}>${value}</div>
  </div>`;
}

/**
 * Info section with header and content (used in client panels, deal modals).
 * @param {string} header - Section header (uppercase label)
 * @param {string} body   - Inner HTML
 * @param {object} opts   - bg, borderColor for container styling
 */
export function infoSection(header, body, { bg = '#f8fafc', borderColor = '#e2e8f0' } = {}) {
  return `<div style="margin-bottom:16px;padding:12px;background:${bg};border-radius:8px;border:1px solid ${borderColor}">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${header}</div>
    ${body}
  </div>`;
}
