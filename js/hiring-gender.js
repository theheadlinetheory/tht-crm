// ═══════════════════════════════════════════════════════════
// HIRING GENDER — a memory aid so Aidan remembers who he spoke to (Aidan,
// 2026-11-24). Shows as ♂/♀ next to the name. Existing cards were guessed from
// the first name (gender_guessed → faint, with a "?"); picking one by hand confirms it.
// Never used for scoring, sorting or filtering.
// ═══════════════════════════════════════════════════════════
import { jsArg } from './utils.js?v=20261124160123';
import { findCandidate, saveFields } from './hiring.js?v=20261124160123';

const GENDERS = { M: { mark: '♂', label: 'Male', color: '#2563eb' }, F: { mark: '♀', label: 'Female', color: '#db2777' } };

export function genderMarkHtml(c) {
  const g = GENDERS[c.gender];
  if (!g) return '';
  const guess = c.gender_guessed;
  return `<span title="${g.label}${guess ? ' (guessed from name)' : ''}" style="color:${g.color};font-weight:800;margin-left:5px;opacity:${guess ? 0.55 : 1}">${g.mark}${guess ? '?' : ''}</span>`;
}

export function genderSelectHtml(c) {
  return `<select onchange="hiringSetGender(${jsArg(c.id)}, this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    <option value="">${c.gender ? 'Unsure' : 'Gender…'}</option>
    ${Object.entries(GENDERS).map(([k, g]) => `<option value="${k}" ${c.gender === k ? 'selected' : ''}>${g.mark} ${g.label}${c.gender === k && c.gender_guessed ? ' (guess)' : ''}</option>`).join('')}
  </select>`;
}

window.hiringSetGender = (id, v) => { const c = findCandidate(id); if (c && ((v || null) !== (c.gender || null) || c.gender_guessed)) saveFields(c, { gender: v || null, gender_guessed: false }); };
