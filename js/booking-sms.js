// ═══════════════════════════════════════════════════════════
// BOOKING-SMS — Text a client when we book them a meeting
// ═══════════════════════════════════════════════════════════
// Manual and button-driven, mirroring the "Send Lead Info to
// Client" email flow. Deliberately never automatic: a text
// cannot be unsent, so a person confirms every send.
//
// Gated per-client on clients.sms_enabled. Sends via Blooio,
// the same account already used to text leads.

import { state, pendingWrites } from './app.js?v=20260821052046';
import { showToast, sbUpdateDeal, camelToSnake } from './api.js?v=20260821052046';
import { registerActions } from './delegate.js?v=20260821052046';
import { modalHeader } from './html-helpers.js?v=20260821052046';
import { esc, str, applyTemplate, svgIcon, fmtDate } from './utils.js?v=20260821052046';
import { isAdmin, isEmployee } from './auth.js?v=20260821052046';
import { sendBlooioText, formatDisplay } from './blooio.js?v=20260821052046';
import { findClientForDeal } from './client-info.js?v=20260821052046';
import { refreshModal } from './render.js?v=20260821052046';

// Note: no line may end in a bare colon. applyTemplate() treats a trailing-colon
// line as an empty label and deletes it, which silently ate the greeting.
export const DEFAULT_BOOKING_SMS_TEMPLATE = `Hi {CLIENT_FIRST} — new meeting booked for you.

{BUSINESS}
{MEETING_TIME}
{ADDRESS}
Contact: {CONTACT}, {PHONE}

Full lead details are in your email.
— The Headline Theory`;

const OVERLAY_ID = 'booking-sms-overlay';

function digitsOf(phone) {
  return str(phone).replace(/\D/g, '');
}

function clientPhone(client) {
  return str(client && client.notifyPhone).trim();
}

function smsEnabled(client) {
  return str(client && client.smsEnabled).toUpperCase() === 'TRUE';
}

function hasBooking(deal) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str(deal && deal.bookedDate));
}

/**
 * Whether the Text Client button should render for this deal.
 * Every condition must hold — a hidden button beats a broken click.
 */
export function canTextClient(deal, client) {
  if (!isAdmin() && !isEmployee()) return false;
  if (!deal || !client) return false;
  if (str(deal.pipeline) !== 'Client') return false;
  if (!smsEnabled(client)) return false;
  if (digitsOf(clientPhone(client)).length < 10) return false;
  return hasBooking(deal);
}

/**
 * Drop template lines whose merge fields all resolved to nothing, so a deal with
 * no contact or phone does not ship a stranded "Contact: ,".
 *
 * A line is dropped only when merging changed nothing versus blanking every
 * placeholder — i.e. every field on it came back empty. Matching on the shape of
 * the merged text instead would eat deliberate lines that merely look like labels.
 */
export function dropEmptyMergeLines(template, merge) {
  const kept = str(template).split('\n').filter(line => {
    if (!/\{[A-Z_]+\}/.test(line)) return true; // no merge fields — always keep
    const blanked = line.replace(/\{[A-Z_]+\}/g, '').trim();
    return merge(line).trim() !== blanked;
  });
  return merge(kept.join('\n'))
    .split('\n')
    // "Contact: Jane Doe, " — one field on the line filled, the next empty.
    .map(line => line.replace(/[\s,;]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildBookingMessage(deal, client) {
  const template = state.savedSettings?.booking_sms_template || DEFAULT_BOOKING_SMS_TEMPLATE;
  const merge = text => applyTemplate(text, deal, str(client.name), str(client.contactFirstName));
  return dropEmptyMergeLines(template, merge);
}

// ─── Button ───

export function renderBookingSmsButton(deal, client) {
  if (!canTextClient(deal, client)) return '';
  const sentAt = str(deal.bookingSmsSentAt).trim();
  const who = str(client.contactFirstName).trim() || str(client.name);
  const label = sentAt
    ? `<span style="color:#059669">${svgIcon('check', 14)} Texted ${esc(fmtDate(sentAt))} — Text Again?</span>`
    : `${svgIcon('message-circle', 14)} Text ${esc(who)} about this meeting`;
  const style = sentAt ? '' : 'background:#059669;border-color:#059669';
  // Inline onclick, not data-action: this button lives inside the deal modal, and
  // renderDealModal's `.modal` carries onclick="event.stopPropagation()". That kills
  // the bubble before it reaches delegate.js's listener on document.body, so a
  // delegated action here silently does nothing. Every other deal-modal button is
  // inline for the same reason. The preview overlay below is appended to <body>, so
  // its own data-action buttons are fine.
  return `<div style="margin:0 0 8px 0">
    <button class="btn ${sentAt ? 'btn-ghost' : 'btn-primary'}" style="width:100%;justify-content:center;gap:6px;font-size:13px;${style}"
      onclick="openBookingSmsPreview('${esc(deal.id)}')"
      title="Text ${esc(clientPhone(client))} about this booked meeting">${label}</button>
  </div>`;
}

// ─── Preview modal ───

function findPair(dealId) {
  const deal = state.deals.find(d => str(d.id) === str(dealId));
  if (!deal) return {};
  // Same resolution the deal modal uses for matchedClient, so the button and
  // the modal can never disagree about who is being texted.
  const client = findClientForDeal(deal) || state.clients.find(c => str(c.name) === str(deal.stage));
  return { deal, client };
}

export function openBookingSmsPreview(dealId) {
  const { deal, client } = findPair(dealId);
  if (!deal || !client || !canTextClient(deal, client)) return;

  document.getElementById(OVERLAY_ID)?.remove();

  const message = buildBookingMessage(deal, client);
  const body = modalHeader(`Text ${esc(client.name)}`, 'closeBookingSms', svgIcon('message', 16))
    + `<div class="modal-body">
      <div style="font-size:12px;line-height:1.8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:12px">
        <div><strong style="color:#dc2626">TO:</strong> <span style="color:#111;font-weight:600">${esc(formatDisplay(clientPhone(client)))}</span></div>
        <div><strong style="color:#6b7280">VIA:</strong> <span style="color:#111">Blooio</span></div>
      </div>
      <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Message (editable)</label>
      <textarea id="booking-sms-body" rows="10"
        style="width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--font);line-height:1.6;resize:vertical;background:var(--card);color:var(--text)">${esc(message)}</textarea>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">A sent text cannot be edited or recalled.</div>
    </div>`
    + `<div class="modal-footer" style="justify-content:flex-end;gap:8px">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" data-action="closeBookingSms">Cancel</button>
      <button id="booking-sms-send" class="btn btn-primary" style="background:#059669;border-color:#059669" data-action="sendBookingSms" data-id="${esc(deal.id)}">Send Text</button>
    </div>`;

  // Built by hand rather than with modalWrap: modalWrap puts its close action on
  // the overlay, and delegate.js fires an action for any descendant click, so a
  // click in the textarea would dismiss the modal. Same backdrop guard as blooio.js.
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="width:480px">${body}</div>`;
  overlay.onmousedown = e => { overlay._downOnBackdrop = (e.target === overlay); };
  overlay.onclick = e => { if (e.target === overlay && overlay._downOnBackdrop) closeBookingSmsPreview(); };
  document.body.appendChild(overlay);
  document.getElementById('booking-sms-body')?.focus();
}

export function closeBookingSmsPreview() {
  document.getElementById(OVERLAY_ID)?.remove();
}

// ─── Send ───

export async function sendBookingSms(dealId) {
  const { deal, client } = findPair(dealId);
  if (!deal || !client) return;

  const message = str(document.getElementById('booking-sms-body')?.value).trim();
  if (!message) { showToast('Message is empty', 'error'); return; }

  const btn = document.getElementById('booking-sms-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; btn.style.opacity = '0.6'; }

  try {
    await sendBlooioText(clientPhone(client), message);
  } catch (e) {
    // Stamp nothing on failure — an un-flipped button is the signal it did not go.
    showToast('Text failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Text'; btn.style.opacity = '1'; }
    return;
  }

  closeBookingSmsPreview();
  deal.bookingSmsSentAt = new Date().toISOString();
  pendingWrites.value++;
  try {
    await sbUpdateDeal(deal.id, camelToSnake({ bookingSmsSentAt: deal.bookingSmsSentAt }));
  } catch (e) {
    console.error('[BookingSMS] Text sent but stamp failed:', e);
  } finally {
    pendingWrites.value--;
  }

  showToast('Texted ' + str(client.name), 'success');
  if (state.selectedDeal && str(state.selectedDeal.id) === str(deal.id)) refreshModal(true);
}

// The preview overlay is a direct child of <body>, so its buttons reach the
// delegated listener. Only the trigger button inside the deal modal needs to be
// reachable from an inline handler — hence the window export.
registerActions({
  closeBookingSms() { closeBookingSmsPreview(); },
  sendBookingSms(el) { sendBookingSms(el.dataset.id); },
});

window.openBookingSmsPreview = openBookingSmsPreview;
