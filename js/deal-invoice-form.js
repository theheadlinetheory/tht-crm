// ═══════════════════════════════════════════════════════════
// DEAL-INVOICE-FORM — pure rendering for the four composer steps.
// No fetch, no state mutation: hands back HTML, takes handlers by name.
// ═══════════════════════════════════════════════════════════
import { esc, escAttr, str } from './utils.js?v=20260923114158';
import { renderTimeline, statusesByIndex } from './invoice-timeline.js?v=20260923114158';
import {
  TERMS, CURRENCIES, PAYMENT_METHODS,
  formatCents, draftTotalCents, lineAmountCents, dueDateLabel, validateDraft, priceInputValue,
} from './deal-invoice-state.js?v=20260923114158';

export const STEPS = [
  { key: 'compose', label: 'Compose' },
  { key: 'review', label: 'Review' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
];

const LBL = 'font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:3px';
const INP = 'width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px';
const BTN = 'padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer';
const PRIMARY = `${BTN};background:#4f46e5;color:#fff;font-weight:700`;
const GHOST = `${BTN};background:#f1f5f9;color:#475569`;
const DANGER = `${BTN};background:#fef2f2;color:#b91c1c`;

const money = (c, cur) => esc(formatCents(c, cur));
const shell = (step, title, inner, footer) => `
  <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
    <h2 style="margin:0;font-size:16px;color:#1e293b">${esc(title)}</h2>
    <button onclick="dealInvoiceDismiss()" style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer">&times;</button>
  </div>
  <div style="padding:16px 22px 20px">
    ${renderTimeline(STEPS, statusesByIndex(STEPS, step))}
    ${inner}
  </div>
  <div style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">${footer}</div>`;

// ─── ① Compose ───

function customerBlock(draft) {
  if (draft.customerId) {
    return `<div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;display:flex;align-items:center;gap:8px">
      <div style="font-size:13px;color:#166534">
        <strong>${esc(draft.customerLabel)}</strong>
        <div style="font-size:11px;color:#3f6212;margin-top:2px">${esc(draft.customerId)}</div>
      </div>
      <button onclick="diClearCustomer()" style="${GHOST};margin-left:auto;padding:5px 12px;font-size:12px">change</button>
    </div>`;
  }
  if (draft.newCustomer) {
    // Every control carries a stable id: paint() swaps innerHTML on each
    // keystroke and re-finds the focused field by id to put the caret back.
    const f = (k, ph) => `<input id="di-new-${k}" value="${escAttr(str(draft.newCustomer[k]))}" placeholder="${escAttr(ph)}"
      oninput="diSetNewCustomer('${k}',this.value)" style="${INP}">`;
    return `<div style="padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px">New Stripe customer</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${f('name', 'Business name')}${f('email', 'Email')}
        ${f('phone', 'Phone (optional)')}${f('addressLine1', 'Address (optional)')}
      </div>
      <button onclick="diClearCustomer()" style="${GHOST};margin-top:8px;padding:5px 12px;font-size:12px">← search instead</button>
    </div>`;
  }
  const results = (draft.customerResults || []).map((c) => `
    <div onclick="diPickCustomer('${escAttr(c.id)}','${escAttr(c.name || c.email)}')"
      style="padding:8px 10px;border-top:1px solid #f1f5f9;cursor:pointer;font-size:13px"
      onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <strong>${esc(c.name || '(no name)')}</strong>
      <span style="color:#64748b;font-size:11px;margin-left:6px">${esc(c.email)} · ${esc(c.id)}</span>
    </div>`).join('');
  return `<div style="border:1px solid #cbd5e1;border-radius:8px;overflow:hidden">
    <input id="di-cust-q" value="${escAttr(str(draft.customerQuery))}" placeholder="Search Stripe customers by name or email"
      oninput="diSearchCustomers(this.value)" style="${INP};border:none;border-radius:0">
    ${results}
    <div onclick="diStartNewCustomer()" style="padding:8px 10px;border-top:1px solid #f1f5f9;cursor:pointer;font-size:13px;color:#4f46e5;font-weight:600">
      + Create new customer…
    </div>
  </div>`;
}

function lineItemRows(draft) {
  return draft.lineItems.map((i, n) => `
    <tr>
      <td style="padding:3px 4px 3px 0"><input id="di-li-${n}-desc" value="${escAttr(str(i.description))}" placeholder="Description"
        oninput="diSetLine(${n},'description',this.value)" style="${INP}"></td>
      <td style="padding:3px 4px;width:64px"><input id="di-li-${n}-qty" value="${escAttr(String(i.quantity))}"
        oninput="diSetLine(${n},'quantity',this.value)" style="${INP};text-align:center"></td>
      <td style="padding:3px 4px;width:110px"><input id="di-li-${n}-price" value="${escAttr(priceInputValue(i))}"
        placeholder="0.00" oninput="diSetLine(${n},'unitAmountCents',this.value)" onblur="diBlurLine(${n})" style="${INP};text-align:right"></td>
      <td style="padding:3px 0 3px 4px;width:100px;text-align:right;font-size:13px;color:#334155">
        ${money(lineAmountCents(i), draft.currency)}</td>
      <td style="width:24px;text-align:right"><button onclick="diRemoveLine(${n})"
        style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:15px">✕</button></td>
    </tr>`).join('');
}

export function renderComposeStep(draft) {
  const errs = validateDraft(draft);
  const cf = draft.customFields.map((f, n) => `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
      <input id="di-cf-${n}-name" value="${escAttr(str(f.name))}" placeholder="Field name" oninput="diSetCustomField(${n},'name',this.value)" style="${INP}">
      <input id="di-cf-${n}-value" value="${escAttr(str(f.value))}" placeholder="Value" oninput="diSetCustomField(${n},'value',this.value)" style="${INP}">
    </div>`).join('');

  const inner = `
    <label style="${LBL}">BILL TO</label>
    ${customerBlock(draft)}

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin:16px 0 4px">
      <label style="${LBL};margin:0">LINE ITEMS</label>
      <select id="di-currency" onchange="diSetField('currency',this.value)" style="${INP};width:auto;padding:4px 8px;font-size:12px">
        ${CURRENCIES.map((c) => `<option value="${c.toLowerCase()}" ${draft.currency === c.toLowerCase() ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <table style="width:100%;border-collapse:collapse"><tbody>${lineItemRows(draft)}</tbody></table>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <button onclick="diAddLine()" style="${GHOST};padding:5px 12px;font-size:12px">+ Add line item</button>
      <div style="font-size:14px;font-weight:700;color:#1e293b">Total ${money(draftTotalCents(draft), draft.currency)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
      <div>
        <label style="${LBL}">TERMS</label>
        <select id="di-terms" onchange="diSetField('terms',this.value)" style="${INP}">
          ${TERMS.map((t) => `<option value="${t.id}" ${draft.terms === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
        ${draft.terms === 'custom'
          ? `<input id="di-duedate" type="date" value="${escAttr(str(draft.customDueDate))}" oninput="diSetField('customDueDate',this.value)" style="${INP};margin-top:6px">`
          : `<div style="font-size:11px;color:#64748b;margin-top:4px">${esc(dueDateLabel(draft))}</div>`}
      </div>
      <div>
        <label style="${LBL}">PAYMENT METHODS</label>
        ${PAYMENT_METHODS.map((m) => `<label style="display:block;font-size:13px;color:#334155;margin-top:4px">
          <input type="checkbox" ${draft.paymentMethods.includes(m.id) ? 'checked' : ''}
            onchange="diTogglePm('${m.id}')"> ${esc(m.label)}</label>`).join('')}
      </div>
    </div>

    <div style="margin-top:14px"><label style="${LBL}">MEMO (shown on the invoice)</label>
      <input id="di-memo" value="${escAttr(str(draft.memo))}" oninput="diSetField('memo',this.value)" style="${INP}"></div>
    <div style="margin-top:10px"><label style="${LBL}">FOOTER</label>
      <input id="di-footer" value="${escAttr(str(draft.footer))}" oninput="diSetField('footer',this.value)" style="${INP}"></div>

    <div style="margin-top:14px"><label style="${LBL}">CUSTOM FIELDS</label>${cf}
      ${draft.customFields.length < 4
        ? `<button onclick="diAddCustomField()" style="${GHOST};margin-top:6px;padding:5px 12px;font-size:12px">+ add field</button>`
        : '<div style="font-size:11px;color:#94a3b8;margin-top:6px">Stripe allows at most 4.</div>'}
    </div>

    ${errs.length ? `<div style="margin-top:14px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#b91c1c">
      ${errs.map((e) => `<div>• ${esc(e)}</div>`).join('')}</div>` : ''}`;

  const footer = `<button onclick="dealInvoiceDismiss()" style="${GHOST}">Cancel</button>
    <button onclick="diGoto('review')" ${errs.length ? 'disabled' : ''}
      style="${PRIMARY}${errs.length ? ';opacity:.45;cursor:not-allowed' : ''}">Review →</button>`;

  return shell('compose', 'Send Invoice', inner, footer);
}

// ─── Shared invoice preview (② and ③) ───

function preview({ customerName, customerEmail, customerNote, customFields, lineItems, totalCents, currency, dueLabel, memo, footer, paymentMethods }) {
  const rows = lineItems.map((l) => `<tr>
    <td style="padding:5px 0;font-size:13px;color:#334155">${esc(l.description)}</td>
    <td style="padding:5px 0;text-align:right;font-size:12px;color:#64748b;white-space:nowrap">${esc(String(l.quantity))} ×</td>
    <td style="padding:5px 0 5px 12px;text-align:right;font-size:13px;color:#334155;white-space:nowrap">${money(l.amountCents, currency)}</td>
  </tr>`).join('');
  const fields = (customFields || []).filter((f) => f.name).map((f) =>
    `<div style="font-size:12px;color:#475569"><span style="color:#94a3b8">${esc(f.name)}</span> ${esc(f.value)}</div>`).join('');

  return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;background:#fff">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#94a3b8;text-align:center;margin-bottom:14px">INVOICE</div>
    <div style="font-size:11px;color:#94a3b8">BILL TO</div>
    <div style="font-size:14px;font-weight:700;color:#1e293b">${esc(customerName || '—')}</div>
    <div style="font-size:12px;color:#475569">${esc(customerEmail || '')}</div>
    ${customerNote ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(customerNote)}</div>` : ''}
    ${fields ? `<div style="margin-top:8px">${fields}</div>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:14px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9"><tbody>${rows}</tbody></table>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#1e293b">
      <span>Total due</span><span>${money(totalCents, currency)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-top:4px">
      <span>Due date</span><span>${esc(dueLabel)}</span></div>
    ${memo ? `<div style="margin-top:12px;font-size:12px;color:#475569"><span style="color:#94a3b8">Memo</span> ${esc(memo)}</div>` : ''}
    ${footer ? `<div style="margin-top:4px;font-size:12px;color:#475569"><span style="color:#94a3b8">Footer</span> ${esc(footer)}</div>` : ''}
    ${paymentMethods ? `<div style="margin-top:4px;font-size:12px;color:#475569"><span style="color:#94a3b8">Accepts</span> ${esc(paymentMethods)}</div>` : ''}
  </div>`;
}

const pmLabels = (ids) => ids.map((i) => PAYMENT_METHODS.find((m) => m.id === i)?.label || i).join(' · ');

// ─── ② Review ───

export function renderReviewStep(draft) {
  const inner = `
    ${preview({
      customerName: draft.customerId ? draft.customerLabel : (draft.newCustomer?.name || ''),
      customerEmail: draft.customerId ? '' : (draft.newCustomer?.email || ''),
      customerNote: draft.customerId ? draft.customerId : 'new customer — will be created',
      customFields: draft.customFields,
      lineItems: draft.lineItems.map((i) => ({
        description: i.description, quantity: i.quantity, amountCents: lineAmountCents(i),
      })),
      totalCents: draftTotalCents(draft), currency: draft.currency,
      dueLabel: dueDateLabel(draft), memo: draft.memo, footer: draft.footer,
      paymentMethods: pmLabels(draft.paymentMethods),
    })}
    <div style="margin-top:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e">
      ⚠ Nothing has been sent. Creating a draft does not email anyone.
    </div>`;
  const footer = `<button onclick="diGoto('compose')" style="${GHOST}">← Edit</button>
    <button id="di-create" onclick="diCreateDraft()" style="${PRIMARY}">Create Draft</button>`;
  return shell('review', 'Review before creating', inner, footer);
}

// ─── ③ Draft (hydrated from Stripe) ───

// Stripe leaves due_date null on a draft created with days_until_due — it is
// only computed at finalization — so the terms are what we have to show.
function draftDueLabel(inv) {
  if (inv.dueDate) return inv.dueDate;
  if (inv.daysUntilDue === 0) return 'Due on receipt';
  if (typeof inv.daysUntilDue === 'number') return `Net ${inv.daysUntilDue}`;
  return '—';
}

export function renderDraftStep(inv) {
  const inner = `
    <div style="margin-bottom:12px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534">
      ✓ Draft created in Stripe${inv.number ? ` · ${esc(inv.number)}` : ''} · ${esc(inv.customer.id)}
    </div>
    ${preview({
      customerName: inv.customer.name, customerEmail: inv.customer.email, customerNote: inv.customer.id,
      customFields: inv.customFields, lineItems: inv.lineItems,
      totalCents: inv.totalCents, currency: inv.currency,
      dueLabel: draftDueLabel(inv), memo: inv.memo, footer: inv.footer,
      paymentMethods: pmLabels(inv.paymentMethods || []),
    })}
    <div style="margin-top:12px;font-size:11px;color:#94a3b8">
      Read back from Stripe, not from what you typed.
    </div>`;
  const footer = `
    <button onclick="diGoto('compose')" style="${GHOST}">← Edit</button>
    <a href="${escAttr(inv.dashboardUrl)}" target="_blank" rel="noopener" style="${GHOST};text-decoration:none;display:inline-block">Open in Stripe ↗</a>
    <button onclick="diDeleteDraft()" style="${DANGER}">Delete draft</button>
    <button onclick="diConfirmSend()" style="${PRIMARY}">Finalize &amp; Send</button>`;
  return shell('draft', 'Draft ready', inner, footer);
}

// ─── The send confirmation (Invariant 5) ───

export function renderConfirmSend(inv) {
  const inner = `
    <div style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px">
      <div style="font-size:13px;color:#92400e;font-weight:700;margin-bottom:8px">This will email the invoice.</div>
      <div style="font-size:13px;color:#334155">To <strong>${esc(inv.customer.email || '(no email on file)')}</strong></div>
      <div style="font-size:13px;color:#334155">Amount <strong>${money(inv.totalCents, inv.currency)}</strong></div>
      <div style="font-size:12px;color:#92400e;margin-top:8px">Once finalized the invoice cannot be edited, only voided.</div>
    </div>`;
  const footer = `<button onclick="diGoto('draft')" style="${GHOST}">Cancel</button>
    <button id="di-send" onclick="diDoSend()" style="${BTN};background:#b45309;color:#fff;font-weight:700">Yes — email this invoice</button>`;
  return shell('draft', 'Confirm send', inner, footer);
}

// ─── ④ Sent ───

export function renderSentStep(inv, emailed, sendError) {
  const banner = emailed
    ? `<div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;color:#166534">
         ✓ Invoice ${esc(inv.number || '')} emailed to ${esc(inv.customer.email)}</div>`
    : `<div style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#b91c1c">
         Finalized, but the email did not go out: ${esc(sendError || 'unknown error')}.<br>
         The invoice is live — resend it from the deal card or from Stripe.</div>`;
  const inner = `${banner}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${inv.hostedInvoiceUrl ? `<a href="${escAttr(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener" style="${GHOST};text-decoration:none">View invoice ↗</a>` : ''}
      ${inv.invoicePdf ? `<a href="${escAttr(inv.invoicePdf)}" target="_blank" rel="noopener" style="${GHOST};text-decoration:none">PDF ↗</a>` : ''}
      <a href="${escAttr(inv.dashboardUrl)}" target="_blank" rel="noopener" style="${GHOST};text-decoration:none">Open in Stripe ↗</a>
    </div>`;
  return shell('sent', 'Invoice sent', inner, `<button onclick="dealInvoiceDismiss()" style="${PRIMARY}">Done</button>`);
}
