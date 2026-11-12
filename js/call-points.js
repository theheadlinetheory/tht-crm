// ═══════════════════════════════════════════════════════════
// CALL POINTS — pick facts from a cold call to add to the client pass-off (Tim, 2026-11-10)
// ═══════════════════════════════════════════════════════════
// Timesavers asked for what was said on the call. We give points, never the
// transcript: a transcript invites critique of how we cold call when the client
// only needs the information. generate-passoff writes 3–8 factual points into
// deals.call_points (one per line). The caller ticks the ones to send and they
// go into the pass-off text under "From the call:". What is ticked is read back
// from that text, so editing the text by hand never disagrees with the boxes.
//
// Offered only to clients with clients.share_call_points = true, so clients
// that never asked do not start getting call details. Admins switch it on per
// client from the card.
import { state } from './app.js?v=20261112233213';
import { supabase, sbUpdateClient, showToast } from './api.js?v=20261112233213';
import { esc, jsArg, str } from './utils.js?v=20261112233213';
import { refreshModal } from './render.js?v=20261112233213';
import { isAdmin } from './auth.js?v=20261112233213';
import { onScreenText } from './passoff-core.js?v=20261112233213';

const HEADING = 'From the call:';
const loading = new Set(); // deal ids being fetched

function clientFor(deal, clientName) {
  const name = str(deal.coldCallClient) || clientName;
  return state.clients.find(c => c.name === name) || state.clients.find(c => c.name === clientName) || null;
}

function sharesPoints(client) {
  const v = client && (client.share_call_points ?? client.shareCallPoints);
  return v === true || v === 'true';
}

export function pointsOf(deal) {
  return str(deal.callPoints).split('\n').map(s => s.trim()).filter(Boolean);
}

// The points currently in the pass-off's "From the call:" block.
function pickedIn(text) {
  const i = str(text).indexOf(HEADING);
  if (i < 0) return [];
  const picked = [];
  for (const line of str(text).slice(i + HEADING.length).split('\n').slice(1)) {
    if (!line.startsWith('- ')) break;
    picked.push(line.slice(2).trim());
  }
  return picked;
}

// Rewrite the block: drop the old one, put the new one before "Good luck!" (else at the end).
function withBlock(text, picked) {
  let t = str(text);
  const i = t.indexOf(HEADING);
  if (i >= 0) {
    const lines = t.slice(i).split('\n');
    let n = 1;
    while (n < lines.length && lines[n].startsWith('- ')) n++;
    t = (t.slice(0, i).replace(/\n+$/, '') + '\n\n' + lines.slice(n).join('\n').replace(/^\n+/, '')).trim();
  }
  if (!picked.length) return t;
  const block = HEADING + '\n' + picked.map(p => '- ' + p).join('\n');
  const g = t.lastIndexOf('Good luck!');
  return g >= 0 ? (t.slice(0, g).replace(/\n+$/, '') + '\n\n' + block + '\n\n' + t.slice(g)) : (t + '\n\n' + block);
}

// Card opened after the draft was written: fetch the points once, on their own, so a missing
// column can never break the board's deal load.
async function loadPoints(deal) {
  if (loading.has(deal.id)) return;
  loading.add(deal.id);
  try {
    const { data, error } = await supabase.from('deals').select('call_points').eq('id', deal.id).maybeSingle();
    if (error) throw error;
    for (const d of new Set([state.deals.find(x => x.id === deal.id), state.selectedDeal])) {
      if (d && d.id === deal.id) d.callPoints = str(data && data.call_points);
    }
    if (state.selectedDeal && state.selectedDeal.id === deal.id) refreshModal(true);
  } catch (e) {
    console.warn('[call-points] not loaded:', e && e.message);
    loading.delete(deal.id); // one failed load used to block the points for the whole session (Tim, 2026-11-12)
  }
}

export function renderCallPoints(deal, clientName) {
  if (str(deal.leadSource) !== 'cold_call' || !str(deal.passoffInstructions).trim()) return '';
  const client = clientFor(deal, clientName);
  if (!sharesPoints(client)) {
    if (!isAdmin() || !client) return '';
    return `<div style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px">Points from the call are off for ${esc(client.name)}.
      <a href="#" onclick="event.preventDefault();callPointsEnable(${jsArg(client.id)})" style="color:#7c3aed">Offer them to this client</a> (only if they asked).</div>`;
  }
  if (deal.callPoints === undefined) { loadPoints(deal); return ''; }
  const points = pointsOf(deal);
  if (!points.length) return `<div style="font-size:10px;color:var(--text-muted);margin:-4px 0 8px">No points from the call (no transcript or notes yet). Start over after the transcript lands to get some.</div>`;
  const picked = new Set(pickedIn(deal.passoffInstructions));
  return `<div style="background:#fff;border:1px solid #e9d5ff;border-radius:6px;padding:8px;margin-bottom:8px">
    <div style="font-size:11px;font-weight:700;color:#7c3aed">Points from the call for ${esc(client.name)}</div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">Tick what to add to the pass-off above. Never send the transcript.</div>
    ${points.map((p, i) => `<label style="display:flex;gap:6px;align-items:flex-start;font-size:12px;margin-bottom:3px;cursor:pointer">
      <input type="checkbox" ${picked.has(p) ? 'checked' : ''} onchange="callPointsToggle(${jsArg(deal.id)},${i},this.checked)" style="margin-top:2px">
      <span>${esc(p)}</span></label>`).join('')}
  </div>`;
}

window.callPointsToggle = (dealId, idx, on) => {
  const deal = state.deals.find(d => String(d.id) === String(dealId)) || state.selectedDeal;
  if (!deal) return;
  // Build from the box first: the deal copy can lag what was just typed (its save is debounced, and
  // a background sync can swap in an older row), and ticking brought the older text back (Tim, 2026-11-12).
  const box = document.getElementById('passoff-text');
  const base = onScreenText(box ? box.value : '', deal.passoffInstructions);
  const all = pointsOf(deal);
  const picked = new Set(pickedIn(base));
  if (on) picked.add(all[idx]); else picked.delete(all[idx]);
  // Keep the points in the order Claude gave them.
  const text = withBlock(base, all.filter(p => picked.has(p)));
  if (box) box.value = text;
  window.savePassoffTextClick(dealId, text); // passoff.js: local copy now, debounced save
};

window.callPointsEnable = async (clientId) => {
  const client = state.clients.find(c => String(c.id) === String(clientId));
  if (!client || !confirm(`Offer points from the call on every ${client.name} cold-call pass-off? Only do this if they asked.`)) return;
  try {
    await sbUpdateClient(clientId, { share_call_points: true });
    client.share_call_points = 'true';
    refreshModal(true);
  } catch (e) {
    showToast('Could not switch it on: ' + (e && e.message || e), 'error');
  }
};
