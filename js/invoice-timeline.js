// ═══════════════════════════════════════════════════════════
// INVOICE-TIMELINE — the numbered step strip, shared by the client
// retainer flow (invoice.js) and the deal composer (deal-invoice.js).
// ═══════════════════════════════════════════════════════════

// Linear flows derive their statuses from position; invoice.js keeps its own
// bespoke mapping and passes the result in.
export function statusesByIndex(steps, currentKey) {
  const current = steps.findIndex((s) => s.key === currentKey);
  const out = {};
  steps.forEach((s, i) => {
    out[s.key] = i < current ? 'done' : i === current ? 'active' : 'pending';
  });
  return out;
}

export function renderTimeline(steps, statuses) {
  if (!statuses) return '';
  return `<div style="display:flex;align-items:center;justify-content:center;gap:0;margin:0 0 16px;padding:12px 16px">
    ${steps.map((s, i) => {
      const status = statuses[s.key];
      const color = status === 'done' ? '#059669' : status === 'active' ? '#4f46e5' : '#d1d5db';
      const bg = status === 'done' ? '#ecfdf5' : status === 'active' ? '#eef2ff' : '#f9fafb';
      const icon = status === 'done' ? '✓' : String(i + 1);
      const connector = i < steps.length - 1
        ? `<div style="flex:1;height:2px;background:${statuses[steps[i + 1].key] === 'pending' ? '#e5e7eb' : '#059669'};min-width:24px"></div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:6px">
        <div style="width:24px;height:24px;border-radius:50%;background:${bg};border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${color}">${icon}</div>
        <span style="font-size:11px;font-weight:600;color:${color}">${s.label}</span>
      </div>${connector}`;
    }).join('')}
  </div>`;
}
