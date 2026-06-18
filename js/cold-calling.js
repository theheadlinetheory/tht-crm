import { renderPowerDialer } from './power-dialer.js?v=20260618e';

export function renderColdCallingTab() {
  return '<div style="max-width:1200px;margin:0 auto;padding:16px 20px">' + renderPowerDialer() + '</div>';
}
