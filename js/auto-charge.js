// Admin-only "Auto-charge" toggle on a client's settings card. Auto-charge
// clients are charged in Stripe within a day or so of their invoice going out:
// the invoice email (js/invoice.js) carries a "no need to respond" heads-up, a
// card lands in #client-payments, and they never get reminders.
import { esc, str } from './utils.js?v=20261110105020';

export function renderAutoChargeToggle(c) {
  const on = str(c.autoCharge).toUpperCase() === 'TRUE';
  return `<div style="margin-bottom:8px">
      <label title="Only for clients who approved auto-billing in writing. The invoice email tells them it will be charged in the next day or so, and they never get reminder emails."
        style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${on ? '#7c3aed' : 'var(--border)'};border-radius:6px;cursor:pointer;font-size:12px;background:${on ? '#f5f3ff' : 'var(--card)'}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleClientField('${esc(c.id)}','autoCharge',this.checked)"> 💳 Auto-charge (card on file)
      </label>
    </div>`;
}
