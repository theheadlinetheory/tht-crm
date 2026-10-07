// Admin-only "Auto-charge" toggle on a client's settings card. When on, the
// daily payment check (client-payment-reminder) swaps pay reminders for a
// "we'll auto-charge you, no need to respond" heads-up 2 days before the due
// date, and on the due date reminds #client-payments to charge them in Stripe.
import { esc, str } from './utils.js?v=20261007131252';

export function renderAutoChargeToggle(c) {
  const on = str(c.autoCharge).toUpperCase() === 'TRUE';
  return `<div style="margin-bottom:8px">
      <label title="No reminder emails. #client-payments offers a heads-up email 2 days before the due date, then reminds you to charge them in Stripe on the due date."
        style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${on ? '#7c3aed' : 'var(--border)'};border-radius:6px;cursor:pointer;font-size:12px;background:${on ? '#f5f3ff' : 'var(--card)'}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleClientField('${esc(c.id)}','autoCharge',this.checked)"> 💳 Auto-charge (card on file)
      </label>
    </div>`;
}
