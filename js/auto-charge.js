// Admin-only "Auto-charge" toggle on a client's settings card. Auto-charge
// clients are charged in Stripe the day their invoice goes out: the invoice
// email (js/invoice.js) carries a "no need to respond" heads-up, and the daily
// payment check never sends them reminders.
import { esc, str } from './utils.js?v=20261009113117';

export function renderAutoChargeToggle(c) {
  const on = str(c.autoCharge).toUpperCase() === 'TRUE';
  return `<div style="margin-bottom:8px">
      <label title="Charge them in Stripe the day the invoice goes out. The invoice email tells them it will be charged, and they never get reminder emails."
        style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${on ? '#7c3aed' : 'var(--border)'};border-radius:6px;cursor:pointer;font-size:12px;background:${on ? '#f5f3ff' : 'var(--card)'}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleClientField('${esc(c.id)}','autoCharge',this.checked)"> 💳 Auto-charge (card on file)
      </label>
    </div>`;
}
