// Small SVG charts for the CFO Hub — pure functions, numbers in, SVG string out.
// No library: the hub is plain modules and one chart per tab is the whole ask
// (Lars, 2026-10-23: "keep the CFO Hub simple"). Specs follow the dataviz
// skill: thin marks (columns ≤ 24px, 2px lines, ≥ 8px markers), 4px rounded
// data-ends, a 2px surface gap between stacked segments, hairline grid, legend
// for ≥ 2 series, selective direct labels, hover readouts via <title>.
// Palette (validated: all checks pass on the light surface):
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;

/** Clean axis ticks covering [lo, hi] in about `count` steps (1/2/5 × 10^k). */
export function niceTicks(lo, hi, count = 4) {
  if (hi <= lo) return [r2(lo), r2(lo + 1)];  // nothing to scale yet
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / mag;
  const step = (unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let t = start; t < hi + step - 1e-9; t += step) ticks.push(r2(t));
  if (ticks[ticks.length - 1] < hi) ticks.push(r2(ticks[ticks.length - 1] + step));
  return ticks;
}

const compact = (v) => Math.abs(v) >= 1000 ? (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(v));
const tickLabel = (v, isMoney) => (isMoney ? (v < 0 ? '-$' : '$') + compact(Math.abs(v)) : compact(v));

function frame({ width, height, pad }) {
  return { x0: pad.l, x1: width - pad.r, y0: pad.t, y1: height - pad.b };
}

function yAxis(ticks, f, isMoney) {
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v) => f.y1 - ((v - lo) / (hi - lo)) * (f.y1 - f.y0);
  const grid = ticks.map((t) => `<line x1="${f.x0}" x2="${f.x1}" y1="${r2(y(t))}" y2="${r2(y(t))}" stroke="${t === 0 ? INK.secondary : INK.grid}" stroke-width="1"/>
    <text x="${f.x0 - 6}" y="${r2(y(t)) + 3.5}" text-anchor="end" font-size="10" fill="${INK.muted}">${esc(tickLabel(t, isMoney))}</text>`).join('');
  return { y, grid };
}

function xLabels(labels, xOf, f) {
  const every = Math.max(1, Math.ceil(labels.length / 8));
  return labels.map((l, i) => (i % every === 0 || i === labels.length - 1)
    ? `<text x="${r2(xOf(i))}" y="${f.y1 + 14}" text-anchor="middle" font-size="10" fill="${INK.muted}">${esc(l)}</text>` : '').join('');
}

function legend(items, x, y) {
  let cx = x;
  return items.map((it) => {
    const w = it.name.length * 7 + 34;  // measured-ish: 11px text ≈ 6.5px/char + swatch + gap
    const html = `<line x1="${cx}" x2="${cx + 12}" y1="${y}" y2="${y}" stroke="${it.color}" stroke-width="${it.dash ? 2 : 6}" ${it.dash ? 'stroke-dasharray="3 2"' : ''} stroke-linecap="round"/>
      <text x="${cx + 16}" y="${y + 3.5}" font-size="11" fill="${INK.secondary}">${esc(it.name)}</text>`;
    cx += w;
    return html;
  }).join('');
}

const open = (w, h, title) => `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="${esc(title || '')}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" style="display:block;max-width:100%">`;

/** Multi-series line chart. series: [{name, color, values:[number|null]}]. */
export function lineChart({ labels, series, fmt = String, width = 760, height = 220, isMoney = true, title = '' }) {
  const pad = { l: 44, r: 96, t: 22, b: 24 };
  const f = frame({ width, height, pad });
  const all = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const { y, grid } = yAxis(ticks, f, isMoney);
  const n = Math.max(1, labels.length - 1);
  const x = (i) => f.x0 + (i / n) * (f.x1 - f.x0);
  let out = open(width, height, title) + grid + xLabels(labels, x, f);
  out += legend(series, f.x0, 10);
  series.forEach((s) => {
    const pts = s.values.map((v, i) => (v === null || v === undefined) ? null : [r2(x(i)), r2(y(v))]);
    let d = '', pen = false;
    pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? ' L' : ' M') + p[0] + ' ' + p[1]; pen = true; });
    out += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, i) => { if (!p) return;
      out += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${s.color}" stroke="${INK.surface}" stroke-width="2"><title>${esc(labels[i])} · ${esc(s.name)}: ${esc(fmt(s.values[i]))}</title></circle>`; });
    const lastIdx = s.values.map((v, i) => (v === null || v === undefined) ? -1 : i).filter((i) => i >= 0).pop();
    if (lastIdx !== undefined) {
      const p = pts[lastIdx];
      out += `<text x="${p[0] + 8}" y="${p[1] + 3.5}" font-size="11" font-weight="600" fill="${INK.primary}">${esc(fmt(s.values[lastIdx]))}</text>`;
    }
  });
  return out + '</svg>';
}

/** Stacked columns (part-to-whole per period) with an optional line on the same axis. */
export function stackedColumns({ labels, series, line = null, fmt = String, width = 760, height = 240, isMoney = true, title = '' }) {
  const pad = { l: 44, r: 16, t: 22, b: 24 };
  const f = frame({ width, height, pad });
  const totals = labels.map((_, i) => series.reduce((s, sr) => s + (Number(sr.values[i]) || 0), 0));
  const top = Math.max(0, ...totals, ...(line ? line.values.filter((v) => v !== null && v !== undefined) : []));
  const ticks = niceTicks(0, top, 4);
  const { y, grid } = yAxis(ticks, f, isMoney);
  const slot = (f.x1 - f.x0) / Math.max(1, labels.length);
  const bw = Math.min(24, slot * 0.6);
  const xc = (i) => f.x0 + slot * (i + 0.5);
  let out = open(width, height, title) + grid + xLabels(labels, xc, f);
  out += legend([...series, ...(line ? [{ ...line, dash: true }] : [])], f.x0, 10);
  labels.forEach((l, i) => {
    let acc = 0;
    series.forEach((s) => {
      const v = Number(s.values[i]) || 0;
      if (v <= 0) return;
      const yTop = y(acc + v), yBot = y(acc);
      const h = Math.max(0, yBot - yTop - 2);  // 2px surface gap between segments
      if (h > 0) out += `<rect class="seg" x="${r2(xc(i) - bw / 2)}" y="${r2(yTop)}" width="${r2(bw)}" height="${r2(h)}" fill="${s.color}" rx="${acc + v >= totals[i] - 1e-9 ? 4 : 0}"><title>${esc(l)} · ${esc(s.name)}: ${esc(fmt(v))} (total ${esc(fmt(totals[i]))})</title></rect>`;
      acc += v;
    });
  });
  if (line) {
    const pts = line.values.map((v, i) => (v === null || v === undefined) ? null : [r2(xc(i)), r2(y(v))]);
    let d = '', pen = false;
    pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? ' L' : ' M') + p[0] + ' ' + p[1]; pen = true; });
    out += `<path d="${d.trim()}" fill="none" stroke="${line.color}" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, i) => { if (!p) return;
      out += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${line.color}" stroke="${INK.surface}" stroke-width="2"><title>${esc(labels[i])} · ${esc(line.name)}: ${esc(fmt(line.values[i]))}</title></circle>`; });
  }
  return out + '</svg>';
}

/** Horizontal bars around a zero baseline (polarity). rows: [{name, value}] in display order. */
export function hBars({ rows, colors = { pos: SERIES[0], neg: SERIES[1] }, fmt = String, width = 760, rowH = 22, title = '' }) {
  const vals = rows.map((r) => Number(r.value) || 0);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  // Negative bars grow left and carry their value at the tip, so when any
  // exist the plot starts further right — the label must never meet the name.
  const pad = { l: 190 + (lo < 0 ? 56 : 0), r: 64, t: 8, b: 8 };
  const height = pad.t + pad.b + rows.length * rowH;
  const f = frame({ width, height, pad });
  const x = (v) => f.x0 + ((v - lo) / ((hi - lo) || 1)) * (f.x1 - f.x0);
  const x0 = r2(x(0));
  let out = open(width, height, title);
  out += `<line x1="${x0}" x2="${x0}" y1="${f.y0}" y2="${f.y1}" stroke="${INK.secondary}" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const v = vals[i];
    const cy = f.y0 + i * rowH + rowH / 2;
    const bh = Math.min(14, rowH - 6);
    const xa = r2(Math.min(x0, x(v))), w = r2(Math.abs(x(v) - x0));
    const color = v < 0 ? colors.neg : colors.pos;
    out += `<text x="${182}" y="${r2(cy + 3.5)}" text-anchor="end" font-size="11" fill="${INK.secondary}">${esc(r.name)}</text>`;
    if (w > 0) out += `<rect x="${xa}" y="${r2(cy - bh / 2)}" width="${w}" height="${bh}" fill="${color}" rx="4"><title>${esc(r.name)}: ${esc(fmt(v))}</title></rect>`;
    const lx = v < 0 ? xa - 6 : xa + w + 6;
    out += `<text x="${r2(lx)}" y="${r2(cy + 3.5)}" text-anchor="${v < 0 ? 'end' : 'start'}" font-size="11" font-weight="600" fill="${INK.primary}">${esc(fmt(v))}</text>`;
  });
  return out + '</svg>';
}
