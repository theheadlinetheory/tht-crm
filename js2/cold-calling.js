import { state } from './app.js?v=20260618e';
import { render } from './render.js?v=20260618e';
import { renderPowerDialer } from './power-dialer.js?v=20260618e';

export function renderColdCallingTab() {
  let h = '<div style="max-width:1200px;margin:0 auto;padding:16px 20px">';
  state.coldCallMode = 'power_dialer';
  return h + renderPowerDialer() + '</div>';
}
