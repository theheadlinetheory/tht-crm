import { renderPowerDialer } from './power-dialer.js?v=20260715a';

export function renderColdCallingTab() {
  return '<div style="margin:0 auto;padding:0">' + renderPowerDialer() + '</div>';
}
