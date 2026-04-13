// js/number-health.js — Dialer number health tracking and smart number selection

import { supabase } from './api.js';
import { sbCall } from './api.js';
import { AC_REGION, JUSTCALL_NUMBERS } from './config.js';
import { esc, svgIcon } from './utils.js';

/* ── Constants ─────────────────────────────────────────────── */
const ANSWER_THRESHOLD = 0.30;
const MIN_CALLS_FOR_DISABLE = 20;

/* ── State ─────────────────────────────────────────────────── */
let healthData = {}; // keyed by number string, e.g. '+17372997832'

/* ── Data Loading ──────────────────────────────────────────── */

export async function loadNumberHealth() {
  const rows = await sbCall(async () => {
    const { data, error } = await supabase
      .from('number_health')
      .select('*');
    if (error) throw error;
    return data;
  }, { label: 'Load number health' });

  healthData = {};
  for (const row of (rows || [])) {
    healthData[row.number] = row;
  }

  // Seed any JUSTCALL_NUMBERS not yet in the table
  for (const [region, cfg] of Object.entries(JUSTCALL_NUMBERS)) {
    if (!healthData[cfg.number]) {
      const seed = {
        number: cfg.number,
        region,
        label: cfg.label,
        total_calls: 0,
        answered: 0,
        last_used: null,
        disabled: false,
        disabled_at: null,
      };
      healthData[cfg.number] = seed;
      // Upsert so it exists for future loads
      sbCall(async () => {
        const { error } = await supabase
          .from('number_health')
          .upsert(seed, { onConflict: 'number' });
        if (error) throw error;
      }, { label: 'Seed number health' });
    }
  }
}

/* ── Lookups ───────────────────────────────────────────────── */

export function getHealthyNumber(region) {
  const cfg = JUSTCALL_NUMBERS[region];
  if (!cfg) return null;
  const entry = healthData[cfg.number];
  if (!entry || entry.disabled) return null;
  return cfg.number;
}

export function getRegionForPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  // US numbers: could be 10 digits or 11 (with leading 1)
  let areaCode;
  if (digits.length === 11 && digits[0] === '1') {
    areaCode = parseInt(digits.substring(1, 4), 10);
  } else if (digits.length === 10) {
    areaCode = parseInt(digits.substring(0, 3), 10);
  } else {
    return null;
  }
  return AC_REGION[areaCode] || null;
}

/* ── Call Outcome Tracking ─────────────────────────────────── */

export async function recordCallOutcome(number, wasAnswered) {
  const entry = healthData[number];
  if (!entry) return;

  entry.total_calls = (entry.total_calls || 0) + 1;
  if (wasAnswered) entry.answered = (entry.answered || 0) + 1;
  entry.last_used = new Date().toISOString();

  // Auto-disable check
  if (
    entry.total_calls >= MIN_CALLS_FOR_DISABLE &&
    entry.answered / entry.total_calls < ANSWER_THRESHOLD
  ) {
    entry.disabled = true;
    entry.disabled_at = new Date().toISOString();
  }

  await sbCall(async () => {
    const { error } = await supabase
      .from('number_health')
      .update({
        total_calls: entry.total_calls,
        answered: entry.answered,
        last_used: entry.last_used,
        disabled: entry.disabled,
        disabled_at: entry.disabled_at,
      })
      .eq('number', number);
    if (error) throw error;
  }, { label: 'Record call outcome' });
}

/* ── Toggle Disabled ───────────────────────────────────────── */

export async function toggleNumberDisabled(number) {
  const entry = healthData[number];
  if (!entry) return;

  entry.disabled = !entry.disabled;
  entry.disabled_at = entry.disabled ? new Date().toISOString() : null;

  await sbCall(async () => {
    const { error } = await supabase
      .from('number_health')
      .update({
        disabled: entry.disabled,
        disabled_at: entry.disabled_at,
      })
      .eq('number', number);
    if (error) throw error;
  }, { label: 'Toggle number disabled' });
}

/* ── Stats Access ──────────────────────────────────────────── */

export function getNumberStats() {
  return { ...healthData };
}

/* ── Settings Panel Render ─────────────────────────────────── */

export function renderNumberHealthSettings() {
  const numbers = Object.values(healthData);
  numbers.sort((a, b) => (a.region || '').localeCompare(b.region || ''));

  const rows = numbers.map(n => {
    const total = n.total_calls || 0;
    const answered = n.answered || 0;
    const rate = total > 0 ? answered / total : 0;
    const pct = Math.round(rate * 100);

    // Color logic: gray if <5 calls, green ≥50%, yellow ≥30%, red <30%
    let rateColor, rateLabel;
    if (total < 5) {
      rateColor = '#999';
      rateLabel = `${pct}%`;
    } else if (rate >= 0.5) {
      rateColor = '#22c55e';
      rateLabel = `${pct}%`;
    } else if (rate >= ANSWER_THRESHOLD) {
      rateColor = '#eab308';
      rateLabel = `${pct}%`;
    } else {
      rateColor = '#ef4444';
      rateLabel = `${pct}%`;
    }

    const statusBadge = n.disabled
      ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;">Burned</span>`
      : `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;">Active</span>`;

    const reEnableLink = n.disabled
      ? ` <a href="#" onclick="reEnableNumber('${esc(n.number)}');return false;" style="color:#3b82f6;font-size:12px;text-decoration:underline;margin-left:6px;">Re-enable</a>`
      : '';

    return `<tr>
      <td style="font-family:monospace;font-size:13px;padding:8px 12px;">${esc(n.number)}</td>
      <td style="padding:8px 12px;">${esc(n.region || '—')} <span style="color:#888;font-size:12px;">(${esc(n.label || '')})</span></td>
      <td style="padding:8px 12px;text-align:center;">${total}</td>
      <td style="padding:8px 12px;text-align:center;color:${rateColor};font-weight:600;">${rateLabel}</td>
      <td style="padding:8px 12px;text-align:center;">${statusBadge}${reEnableLink}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:16px;">
      <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;">
        ${svgIcon('phone', 16)} Dialer Number Health
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;text-align:left;">
            <th style="padding:8px 12px;font-weight:600;">Number</th>
            <th style="padding:8px 12px;font-weight:600;">Region</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Calls</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Answer %</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" style="padding:16px;text-align:center;color:#999;">No numbers configured</td></tr>'}
        </tbody>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#888;">
        Numbers are auto-disabled when answer rate drops below 30% after 20+ calls.
      </p>
    </div>`;
}

/* ── Global Hooks ──────────────────────────────────────────── */

window.__numberHealthModule = { renderNumberHealthSettings };
window.reEnableNumber = async function(number) {
  await toggleNumberDisabled(number);
  const { render } = await import('./render.js');
  render();
};
