// ═══════════════════════════════════════════════════════════
// DEAL-INVOICE — one-off Stripe invoice on an Acquisition deal.
// Admin-only, ONE invoice per deal, body-level overlay (survives render()).
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260723c';
import { str, esc } from './utils.js?v=20260723c';
import { invokeEdgeFunction, showToast, sbUpdateDeal, camelToSnake } from './api.js?v=20260723c';
import { isAdmin } from './auth.js?v=20260723c';
import { render } from './render.js?v=20260723c';

const INVOICE_STAGES = ['Under Review', 'Waiting for Payment/Contract'];
const CURRENCIES = ['USD', 'AUD', 'CAD', 'GBP'];

export function renderDealInvoiceButton(deal) {
  if (!isAdmin() || deal.pipeline !== 'Acquisition' || !INVOICE_STAGES.includes(deal.stage)) return '';
  if (str(deal.invoiceId)) {
    const amt = Number(deal.invoiceAmount || 0);
    const cur = str(deal.invoiceCurrency || 'usd').toUpperCase();
    const when = deal.invoicedAt ? new Date(deal.invoicedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const link = str(deal.invoiceUrl);
    return `<div class="form-group form-span2" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534">
        ✓ Invoiced ${esc(cur)} ${amt.toLocaleString()}${when ? ' on ' + esc(when) : ''}
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" style="margin-left:auto;color:#2563eb;font-weight:600;text-decoration:none">View invoice ↗</a>` : ''}
      </div></div>`;
  }
  return `<div class="form-group form-span2" style="margin-bottom:16px">
    <button onclick="openDealInvoiceModal('${esc(deal.id)}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Send Invoice</button>
  </div>`;
}

const inp = (id, value, ph = '') => `<input id="${id}" value="${esc(str(value))}" placeholder="${esc(ph)}" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px">`;
const lbl = (t) => `<label style="font-size:11px;font-weight:600;color:#64748b">${t}</label>`;
const gv = (id) => (document.getElementById(id)?.value || '').trim();

let _dealId = '';

export function openDealInvoiceModal(dealId) {
  if (!isAdmin()) return;
  const deal = state.deals.find((d) => String(d.id) === String(dealId));
  if (!deal || str(deal.invoiceId)) return; // one invoice per deal
  _dealId = dealId;
  const name = str(deal.company || deal.contact);
  const html = `<div id="di-overlay" style="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)dealInvoiceDismiss()">
    <div style="background:#fff;border-radius:12px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)" onclick="event.stopPropagation()">
      <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:16px;color:#1e293b">Send Invoice — ${esc(name)}</h2>
        <button onclick="dealInvoiceDismiss()" style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div style="padding:20px 22px">
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
          <div>${lbl('Amount')}${inp('di-amount', '', 'e.g. 1500')}</div>
          <div>${lbl('Currency')}<select id="di-currency" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-top:3px">${CURRENCIES.map((c) => `<option value="${c.toLowerCase()}">${c}</option>`).join('')}</select></div>
        </div>
        <div style="margin-top:12px">${lbl('Recipient email')}${inp('di-email', str(deal.email))}</div>
        <div style="margin-top:12px">${lbl('Description')}${inp('di-desc', 'The Headline Theory — services')}</div>
      </div>
      <div id="di-footer" style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px">
        <button onclick="dealInvoiceDismiss()" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
        <button id="di-send" onclick="sendDealInvoice()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Send Invoice</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

export function dealInvoiceDismiss() {
  document.getElementById('di-overlay')?.remove();
  _dealId = '';
}

export async function sendDealInvoice() {
  const deal = state.deals.find((d) => String(d.id) === String(_dealId));
  if (!deal) return;
  const amount = parseFloat(gv('di-amount'));
  const email = gv('di-email');
  const currency = document.getElementById('di-currency')?.value || 'usd';
  const description = gv('di-desc') || 'The Headline Theory — services';
  if (!(amount > 0)) { showToast('Enter an amount greater than 0', 'error'); return; }
  if (!email) { showToast('Recipient email is required', 'error'); return; }
  const btn = document.getElementById('di-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const r = await invokeEdgeFunction('create-deal-invoice', {
      dealId: deal.id,
      name: str(deal.company || deal.contact),
      email,
      amountCents: Math.round(amount * 100),
      currency,
      description,
    });
    if (r?.error || !r?.invoiceId) throw new Error(r?.error || 'No invoice id returned');
    const fields = {
      invoiceId: r.invoiceId,
      invoiceAmount: amount,
      invoiceCurrency: currency,
      invoiceUrl: r.hostedInvoiceUrl || '',
      invoicedAt: new Date().toISOString(),
    };
    Object.assign(deal, fields);
    dealInvoiceDismiss();
    render();
    await sbUpdateDeal(deal.id, camelToSnake(fields));
    showToast(`Invoice sent to ${email}`, 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Invoice'; }
    showToast('Invoice failed: ' + (e?.message || e), 'error');
  }
}

window.openDealInvoiceModal = openDealInvoiceModal;
window.dealInvoiceDismiss = dealInvoiceDismiss;
window.sendDealInvoice = sendDealInvoice;
