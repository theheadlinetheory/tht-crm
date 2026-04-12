// ═══════════════════════════════════════════════════════════
// DIALER — JustCall Sales Dialer integration (popup mode)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { str, esc } from './utils.js';

export function initJustCallDialer(){
  // Sales Dialer uses popup — no embedded iframe needed
}

export function callInJustCall(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const phone=str(deal.phone)||str(deal.mobilePhone);
  if(!phone){alert('No phone number on this deal.');return;}
  const digits=phone.replace(/\D/g,'');
  const formatted=digits.length===10?'+1'+digits:digits.length===11&&digits[0]==='1'?'+'+digits:'+'+digits;

  // Build metadata for webhook call-back matching
  const metadata=JSON.stringify({
    dealId: deal.id,
    company: deal.company||'',
    contact: deal.contact||'',
    pipeline: deal.pipeline||'',
    campaignName: deal.campaignName||''
  });

  const url='https://app.justcall.io/dialer'
    +'?numbers='+encodeURIComponent(formatted)
    +'&medium=custom'
    +'&metadata='+encodeURIComponent(metadata)
    +'&metadata_type=json';

  window.open(url,'justcall-sales-dialer','width=400,height=700,location=no');
}

// Expose to inline HTML handlers
window.callInJustCall = callInJustCall;
