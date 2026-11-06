// ═══════════════════════════════════════════════════════════
// HIRING ACTIVITY — a hiring card's timeline + follow-ups (hiring_activities,
// tht-crm-backend migration 20261106_hiring_activity_tracking.sql).
// Its own table and its own cache, never state.activities: the deal activity
// list feeds overdue banners, badges, the Dashboard and the Funnel, and
// nothing about hiring may show up there. Admin-only by RLS.
// Types: reply_in · message_out · note · stage · followup (due_at / done_at).
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20261106130356';
import { showToast } from './api.js?v=20261106130356';

const TABLE = 'hiring_activities';
const PAGE = 1000;
const _byCandidate = new Map(); // candidate id → rows (oldest first); absent = not loaded

/** Rows for a card, or undefined while they have not loaded yet. */
export const activitiesFor = (candidateId) => _byCandidate.get(candidateId);

export async function loadActivities(candidateId) {
  let all = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('candidate_id', candidateId)
      .order('created_at', { ascending: true }).range(off, off + PAGE - 1);
    if (error) { showToast('Could not load the timeline: ' + error.message); return; }
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  _byCandidate.set(candidateId, all);
}

export async function addHiringActivity(candidateId, fields) {
  const { data, error } = await supabase.from(TABLE).insert({ candidate_id: candidateId, ...fields }).select('*').single();
  if (error) { showToast('Save failed: ' + error.message); return null; }
  _byCandidate.get(candidateId)?.push(data);
  return data;
}

export async function updateHiringActivity(row, patch) {
  const before = { ...row };
  Object.assign(row, patch);
  const { error } = await supabase.from(TABLE).update(patch).eq('id', row.id);
  if (error) { Object.assign(row, before); showToast('Save failed: ' + error.message); }
}

export async function deleteHiringActivity(row) {
  const { error } = await supabase.from(TABLE).delete().eq('id', row.id);
  if (error) { showToast('Delete failed: ' + error.message); return; }
  const rows = _byCandidate.get(row.candidate_id);
  if (rows) _byCandidate.set(row.candidate_id, rows.filter(r => r.id !== row.id));
}

export const findActivity = (candidateId, id) => (_byCandidate.get(candidateId) || []).find(r => r.id === id);
