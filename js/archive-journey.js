// ═══════════════════════════════════════════════════════════
// ARCHIVE JOURNEY — where an archived lead left the sales funnel, and why (Lars, 2026-09-16: "we'll use different
// reactivation messaging for someone who left at stage 2 than someone who left at stage 5, and the reason they left")
// ═══════════════════════════════════════════════════════════
// The funnel's ledger (pipeline_leads, rebuilt hourly by the pipeline) already knows, for every lead that replied
// since 2026-05-04, the furthest level it reached and why it left. This module reads it once and answers by deal id.
// Both archive screens (the admin Archive tab and the employees' Archived Deals view) use it — keep them identical.
import { supabase } from './api.js?v=20260923101432';

export const LEFT_AT_OPTIONS = ['Replied', 'Disco booked', 'Disco held', 'Demo booked', 'Demo held', 'Closed', 'Not in the funnel'];
export const WHY_OPTIONS = ['No reason recorded', 'Said no / lost', 'Not right now', 'Cancelled, never rebooked', 'No-show', 'DQ on the disco', 'DQ on the demo', 'Removed by us', 'Still open'];

const COLS = 'demo_no_show,disco_conducted_at,won_at,disco_dq,disco_scheduled_at,disco_no_show,disco_booking_cancelled,demo_scheduled_at,demo_cancelled,demo_conducted_at,deal_ids,deal_id,removed_reason,disco_outcome,demo_outcome,bucket02,told_no_how,lead_email';
const TTL_MS = 10 * 60e3;
let _byDeal = new Map(), _loadedAt = 0, _loading = null;

function classify(l) {
  const leftAt = l.won_at ? 'Closed' : l.demo_conducted_at ? 'Demo held' : l.demo_scheduled_at ? 'Demo booked'
    : l.disco_conducted_at ? 'Disco held' : l.disco_scheduled_at ? 'Disco booked' : 'Replied';
  const rr = String(l.removed_reason || ''), tn = String(l.told_no_how || '');
  const why = ['removed_desk_dq', 'removed_not_real', 'removed_duplicate'].includes(l.bucket02) ? 'Removed by us'
    : l.demo_outcome === 'not_qualified' ? 'DQ on the demo'
    : l.disco_dq ? 'DQ on the disco'
    : /^(Deleted\/Lost|Closed Lost|Lost) \(no reason/.test(rr) ? 'No reason recorded'
    : (/Nurture/i.test(tn) || l.demo_outcome === 'not_right_now') ? 'Not right now'
    : (l.demo_cancelled || l.disco_booking_cancelled) ? 'Cancelled, never rebooked'
    : (l.demo_no_show || l.disco_no_show) ? 'No-show'
    : (tn || l.demo_outcome === 'lost' || rr) ? 'Said no / lost'
    : 'Still open';
  const reason = rr || tn || (l.demo_outcome ? 'Demo: ' + l.demo_outcome.replace(/_/g, ' ') : '') || (l.disco_outcome ? 'Disco: ' + l.disco_outcome : '');
  return { leftAt, why, reason, email: l.lead_email };
}

/** Load (or refresh) the ledger. Safe to call often: one request per 10 minutes. */
export function loadJourneys(force) {
  if (!force && (_loading || Date.now() - _loadedAt < TTL_MS)) return _loading || Promise.resolve();
  _loading = supabase.from('pipeline_leads').select(COLS).range(0, 9999)
    .then(({ data, error }) => {
      if (error) { console.warn('[archive-journey]', error.message); return; }
      const m = new Map();
      for (const l of data || []) {
        const j = classify(l);
        for (const id of [l.deal_id, ...(Array.isArray(l.deal_ids) ? l.deal_ids : [])]) if (id) m.set(String(id), j);
      }
      _byDeal = m; _loadedAt = Date.now();
    })
    .catch((e) => console.warn('[archive-journey]', e && e.message))
    .finally(() => { _loading = null; });
  return _loading;
}

/** { leftAt, why, reason } for a deal id, or the "not in the funnel" answer for a lead the ledger does not know. */
export function journeyFor(dealId) {
  return _byDeal.get(String(dealId)) || { leftAt: 'Not in the funnel', why: '', reason: '' };
}
export function journeysLoaded() { return _loadedAt > 0; }
