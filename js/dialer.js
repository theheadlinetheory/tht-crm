// ═══════════════════════════════════════════════════════════
// DIALER — JustCall dialer integration
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { JUSTCALL_NUMBERS, AC_REGION } from './config.js';
import { str, esc } from './utils.js';

export function getJustCallFrom(phone){
  const digits=phone.replace(/\D/g,'');
  const ac=digits.length===11&&digits[0]==='1'?digits.substring(1,4):digits.substring(0,3);
  const region=AC_REGION[parseInt(ac)]||'TX';
  return JUSTCALL_NUMBERS[region];
}

let justcallReady=false;

export function initJustCallDialer(){
  const iframe=document.getElementById('justcall-widget-iframe');
  if(!iframe) return;
  iframe.src='https://app.justcall.io/dialer';
  window.addEventListener('message',function(e){
    if(e.origin!=='https://app.justcall.io') return;
    if(e.data&&e.data.type==='dialer-ready') justcallReady=true;
    if(e.data&&e.data.type==='login-status') justcallReady=true;
  });
  setTimeout(()=>{justcallReady=true;},3000);
}

export function callInJustCall(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const phone=str(deal.phone)||str(deal.mobilePhone);
  if(!phone){alert('No phone number on this deal.');return;}
  const digits=phone.replace(/\D/g,'');
  const formatted=digits.length===10?'+1'+digits:digits.length===11&&digits[0]==='1'?'+'+digits:'+'+digits;
  const fromNum=getJustCallFrom(phone);
  const widget=document.getElementById('justcall-widget');
  const iframe=document.getElementById('justcall-widget-iframe');
  const title=document.getElementById('justcall-widget-title');
  const hint=document.getElementById('justcall-widget-hint');
  title.textContent=esc(deal.company||formatted);
  hint.textContent='Select: '+fromNum.label+' ('+fromNum.number.replace(/(\d)(\d{3})(\d{3})(\d{4})/,'($2) $3-$4')+')';
  hint.style.display='block';
  widget.style.display='flex';
  setTimeout(()=>{
    iframe.contentWindow.postMessage({type:'dial-number',phoneNumber:formatted},'https://app.justcall.io');
  },500);
}

export function closeJustCallWidget(){
  document.getElementById('justcall-widget').style.display='none';
}

export function toggleJustCallMinimize(){
  const widget=document.getElementById('justcall-widget');
  const iframe=document.getElementById('justcall-widget-iframe');
  const btn=document.getElementById('justcall-minimize-btn');
  if(iframe.style.display==='none'){
    iframe.style.display='';
    widget.style.height='660px';
    btn.textContent='\u2500';
  } else {
    iframe.style.display='none';
    widget.style.height='auto';
    btn.textContent='\u25A1';
  }
}

// Expose to inline HTML handlers
window.callInJustCall = callInJustCall;
window.closeJustCallWidget = closeJustCallWidget;
window.toggleJustCallMinimize = toggleJustCallMinimize;
