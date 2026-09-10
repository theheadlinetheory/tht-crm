// ═══════════════════════════════════════════════════════════
// GMAIL-THREADS — the deal's correspondence, read from Gmail
// ═══════════════════════════════════════════════════════════
//
// After a disco or demo the conversation leaves SmartLead and continues in a
// staff member's own inbox. This puts that history on the deal card.
//
// Nothing is stored: the edge function reads Gmail live and returns it. The
// cache below is per-session and in-memory only, so closing the tab forgets it.
//
// Mirrors the SmartLead thread viewer in threads.js — on-demand button, latest
// message expanded, older ones behind a toggle — so the two read the same way.

import { state } from './app.js?v=20260910165154';
import { esc, str, svgIcon } from './utils.js?v=20260910165154';
import { isAdmin, currentUser } from './auth.js?v=20260910165154';
import { invokeEdgeFunctionAsUser } from './edge-auth.js?v=20260910165154';
// Always refreshModal(TRUE): the no-argument form takes a targeted path that
// only replaces #activities-container, so this section — which lives
// elsewhere in the modal — would never repaint after loading.
import { refreshModal } from './render.js?v=20260910165154';
import { sbUpdateDeal } from './api.js?v=20260910165154';

const _cache = {};   // `${dealId}|${mailbox}` -> { threads, participants }
const _state = {};   // dealId -> { mailbox, loading, error }

const key = (dealId, mailbox) => `${dealId}|${mailbox || ''}`;

export function dealHasEmail(deal) {
  return ['email', 'email2', 'email3', 'email4'].some(f => str(deal?.[f]).trim());
}

export function getGmailState(dealId) { return _state[dealId] || {}; }
export function getGmailCache(dealId) { return _cache[key(dealId, _state[dealId]?.mailbox)]; }

export async function loadGmailThreads(dealId, mailbox) {
  // The cache has to be keyed by the mailbox the SERVER resolved, not the one
  // asked for. The first load passes undefined (meaning "my own inbox"), so
  // keying on the request stored it under "" while every later read looked it
  // up under "aidan@…" — a successful load then rendered as if nothing had
  // happened, with no error to show for it.
  const want = mailbox || _state[dealId]?.mailbox || '';
  if (want && _cache[key(dealId, want)]) {
    _state[dealId] = { mailbox: want, loading: false, error: null };
    refreshModal(true);
    return;
  }
  _state[dealId] = { mailbox: want, loading: true, error: null };
  refreshModal(true);
  try {
    const resp = await invokeEdgeFunctionAsUser('gmail-threads', { dealId, mailbox });
    const resolved = resp.mailbox || want || '';
    _cache[key(dealId, resolved)] = { threads: resp.threads || [], participants: resp.participants || [] };
    _state[dealId] = { mailbox: resolved, loading: false, error: null };
  } catch (e) {
    // The scope has to be granted in the Workspace admin console — say so
    // plainly rather than showing a raw Google error.
    _state[dealId] = {
      mailbox: want, loading: false,
      error: e.code === 'scope-missing'
        ? 'Gmail access is not switched on yet for the CRM. Nothing else on this card is affected.'
        : (e.message || 'Could not load email history'),
    };
  }
  refreshModal(true);
}

// ─── Rendering ───

// overflow-wrap:anywhere — real emails carry long unbreakable URLs (Stripe
// invoice links), which otherwise make the body scroll sideways.
function messageHtml(msg, mailbox, isLatest) {
  const outbound = str(msg.from).toLowerCase() === str(mailbox).toLowerCase();
  const who = outbound ? 'You' : (msg.fromName || msg.from || 'Them');
  const when = msg.ts ? new Date(msg.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return `<div style="padding:8px 10px;margin-bottom:4px;background:${outbound ? '#f8fafc' : '#f0fdf4'};border:1px solid ${outbound ? '#e2e8f0' : '#bbf7d0'};border-radius:6px;${outbound ? '' : 'border-left:3px solid #22c55e'}">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
      <span style="font-size:10px;font-weight:600;color:${outbound ? '#6b7280' : '#166534'}">${esc(who)}</span>
      <span style="font-size:10px;color:#9ca3af;white-space:nowrap">${esc(when)}</span>
    </div>
    <div style="font-size:12px;color:#334155;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:${isLatest ? '260px' : '90px'};overflow-y:auto;overflow-x:hidden">${esc(msg.body || msg.snippet || '')}</div>
  </div>`;
}

function threadHtml(thread, mailbox, idx) {
  const msgs = thread.messages || [];
  const latest = msgs[msgs.length - 1];
  const older = msgs.slice(0, -1);
  return `<div style="margin-bottom:10px">
    <div style="font-size:11px;font-weight:600;color:#334155;margin-bottom:4px">${esc(thread.subject)}</div>
    ${older.length ? `<div id="gm-older-${idx}" hidden>${older.map(m => messageHtml(m, mailbox, false)).join('')}</div>
      <button class="btn btn-ghost" style="font-size:10px;width:100%;margin-bottom:4px" onclick="gmailToggleOlder(${idx},this)">Show ${older.length} older message${older.length > 1 ? 's' : ''}</button>` : ''}
    ${latest ? messageHtml(latest, mailbox, true) : ''}
  </div>`;
}

export function renderGmailSection(deal) {
  if (!dealHasEmail(deal)) return '';
  const st = _state[deal.id] || {};
  const cached = _cache[key(deal.id, st.mailbox)];

  let inner;
  if (st.loading) {
    inner = `<div style="font-size:12px;color:#94a3b8;padding:8px 0">Loading email history…</div>`;
  } else if (st.error) {
    inner = `<div style="font-size:12px;color:#b91c1c;padding:6px 0">${esc(st.error)}</div>
      <button class="btn btn-ghost" style="font-size:10px" onclick="gmailLoad('${esc(deal.id)}')">Retry</button>`;
  } else if (!cached) {
    return `<div style="margin-bottom:12px">
      <button class="sl-thread-btn" onclick="gmailLoad('${esc(deal.id)}')">
        ${svgIcon('mail', 14)} View Gmail History
      </button>
    </div>`;
  } else if (!cached.threads.length) {
    inner = `<div style="font-size:12px;color:#94a3b8;padding:6px 0">No email history in ${esc(st.mailbox || 'this mailbox')} for this deal's addresses.</div>`;
  } else {
    inner = cached.threads.map((t, i) => threadHtml(t, st.mailbox, i)).join('');
    // People on the thread the deal doesn't know about. Suggestions only — the
    // deal has four email slots and auto-filling would overwrite real contacts.
    const slot = ['email2', 'email3', 'email4'].find(f => !str(deal[f]).trim());
    if (cached.participants.length && slot) {
      inner += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px">Also on these threads</div>
        ${cached.participants.map(a => `<button onclick="gmailAddParticipant('${esc(deal.id)}','${esc(a)}')"
          style="font-size:11px;margin:0 4px 4px 0;padding:3px 8px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:12px;cursor:pointer">+ ${esc(a)}</button>`).join('')}
      </div>`;
    }
  }

  const mailboxPicker = isAdmin() ? `<select onchange="gmailLoad('${esc(deal.id)}',this.value)"
      style="font-size:10px;padding:1px 4px;border:1px solid var(--border);border-radius:4px;background:var(--card)">
      ${staffMailboxes().map(m => `<option value="${esc(m)}" ${m === st.mailbox ? 'selected' : ''}>${esc(m.split('@')[0])}</option>`).join('')}
    </select>` : '';

  return `<div style="margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:var(--text-muted)">GMAIL HISTORY${cached && cached.threads.length ? ` (${cached.threads.length})` : ''}</span>
      ${mailboxPicker}
    </div>
    ${inner}
  </div>`;
}

// Admins can look at any staff inbox; the edge function re-checks that, so this
// list is only a convenience — it is not what grants access.
function staffMailboxes() {
  const me = str(currentUser?.email).toLowerCase();
  const others = (state.assignableUsers || [])
    .map(u => str(u.email).toLowerCase())
    .filter(e => e.endsWith('@theheadlinetheory.com'));
  return [...new Set([me, ...others].filter(Boolean))];
}

// Inline onclick, not data-action. This section renders inside the deal modal,
// and renderDealModal's `.modal` carries onclick="event.stopPropagation()" —
// which kills the bubble before it reaches delegate.js's listener on
// document.body, so a delegated action here silently does nothing. Every other
// deal-modal button is inline for the same reason (see booking-sms.js).
window.gmailLoad = (dealId, mailbox) => loadGmailThreads(dealId, mailbox || undefined);

window.gmailToggleOlder = (idx, btn) => {
  const box = document.getElementById('gm-older-' + idx);
  if (!box) return;
  box.hidden = !box.hidden;
  btn.textContent = box.hidden ? btn.textContent.replace('Hide', 'Show') : btn.textContent.replace('Show', 'Hide');
};

window.gmailAddParticipant = async (dealId, email) => {
  const deal = state.deals.find(d => String(d.id) === String(dealId));
  if (!deal) return;
  const slot = ['email2', 'email3', 'email4'].find(f => !str(deal[f]).trim());
  if (!slot) return;
  deal[slot] = email;
  try { await sbUpdateDeal(dealId, { [slot]: email }); }
  catch (e) { console.error('Add participant failed:', e); }
  // Next load re-derives the search from the deal, so the new address is
  // searched too — that half needs no extra machinery.
  delete _cache[key(dealId, _state[dealId]?.mailbox)];
  refreshModal(true);
};
