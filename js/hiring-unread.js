// ═══════════════════════════════════════════════════════════
// HIRING UNREAD — the red count bubble on the Hiring nav tab (admin-only).
// Counts hiring_candidates.has_new_activity (new applicant / new reply). Loads
// with the realtime channels at app start, so it shows on every tab, and stays
// live through a hiring_candidates realtime channel. Reads nothing but
// hiring_candidates: no other tab's counts, banners or stats are touched.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20261110102054';
import { isAdmin } from './auth.js?v=20261110102054';

const DEBOUNCE_MS = 800;
let _count = 0;
let _timer = null;
const _listeners = new Set();

/** Called (debounced) after any hiring_candidates change — the board reloads through this. */
export function onHiringChange(fn) { _listeners.add(fn); }

export function hiringNavBubbleHtml() {
  return _count > 0 ? `<span class="tab-bubble" title="${_count} new on Hiring">${_count}</span>` : '';
}

// The nav is not re-rendered for a count change: other tabs may have a modal open.
function paintBubble() {
  const tab = document.querySelector('.topbar-tab[data-pipe="hiring"]');
  if (!tab) return;
  tab.querySelector('.tab-bubble')?.remove();
  tab.insertAdjacentHTML('beforeend', hiringNavBubbleHtml());
}

export async function refreshHiringUnread() {
  if (!isAdmin()) return;
  const { count, error } = await supabase.from('hiring_candidates')
    .select('id', { count: 'exact', head: true }).eq('has_new_activity', true);
  if (error) { console.warn('[hiring] unread count failed:', error.message); return; }
  _count = count || 0;
  paintBubble();
}

function changed() {
  clearTimeout(_timer);
  _timer = setTimeout(() => { refreshHiringUnread(); _listeners.forEach(fn => fn()); }, DEBOUNCE_MS);
}

/** Started from subscribeRealtime (api.js), which tears every channel down on reconnect. */
export function watchHiringUnread(rid) {
  if (!isAdmin()) return;
  refreshHiringUnread();
  supabase.channel(`hiring-candidates-${rid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_candidates' }, changed)
    .subscribe();
}
