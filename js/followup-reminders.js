// ═══════════════════════════════════════════════════════════
// FOLLOW-UP REMINDERS — weekly "chase your leads" email for retainer clients
//
// Retainer clients reply to a delivered lead once and then go quiet. This tab
// builds, per client, the list of every lead they've replied to at most once —
// each rendered in the email as a direct link into that Smartlead conversation
// — and sends it as a friendly nudge.
//
// Deliberately NOT time-boxed: an old lead converts as well as a fresh one, so
// the list is every hanging lead, not just this week's.
//
// Build + send both go through the fulfillment project's
// `followup-reminder-send` edge fn (verify_jwt=false), which owns the Smartlead
// reply-counting and sends FROM tim@theheadlinetheory.com on a dedicated
// "<Client> — lead follow-ups" thread. Recipients come from the CRM DB, same
// rules as Weekly Updates: TO = clients.notify_email, CC = aidan@ + per-client
// extras. Structure mirrors weekly-updates.js on purpose.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260827212923';
import { state } from './app.js?v=20260827212923';
import { render } from './render.js?v=20260827212923';
import { showToast, sbSaveSettings } from './api.js?v=20260827212923';
import { esc, str, svgIcon } from './utils.js?v=20260827212923';

// Lives on the fulfillment-dashboard Supabase project (verify_jwt=false)
const FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/followup-reminder-send';

// Sends the caller's Supabase session token so the edge function can prove the
// request came from a signed-in @theheadlinetheory.com user. Same reasoning as
// weekly-updates.js: this emails real clients from tim@ and its URL is in this
// public repo, so without the header anyone could POST it arbitrary copy.
async function callFn(payload){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: JSON.stringify(payload) });
  const data = await resp.json().catch(()=>({ error:'followup-reminder-send returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('followup-reminder-send failed ('+resp.status+')'));
  return data;
}

export const DEFAULT_FOLLOWUP_TEMPLATE = `Hey {CLIENT_FIRST},

Here's your quick reminder to follow up with your leads.

These are the ones you haven't come back to yet — a lot of them go quiet just because nobody nudged them twice. Click any name to open the conversation and reply.`;

const TOKENS = ['{CLIENT_FIRST}','{CLIENT_NAME}','{LEAD_COUNT}'];

function getFu(){
  if(!state.followup) state.followup = { step:'idle', rows:[], progress:'', tplOpen:false, tplDraft:null, selectedClients:null };
  return state.followup;
}

function currentTemplate(){
  return str(state.savedSettings?.followup_reminder_template) || DEFAULT_FOLLOWUP_TEMPLATE;
}

// Retainer clients are the audience — per-lead clients are billed per delivered
// lead and are deliberately out of scope.
function retainerClients(){
  return (state.clients||[])
    .filter(c => str(c.billingModel)==='retainer' && c.status!=='inactive')
    .slice().sort((a,b)=>str(a.name).localeCompare(str(b.name)));
}

function selectedNames(){
  const f = getFu();
  if(f.selectedClients==null) return new Set(retainerClients().map(c=>c.name));
  return new Set(f.selectedClients);
}
export function fuToggleClient(name){
  const f = getFu();
  const sel = selectedNames();
  if(sel.has(name)) sel.delete(name); else sel.add(name);
  f.selectedClients = [...sel];
  render();
}
export function fuSelectAll(){ getFu().selectedClients = null; render(); }
export function fuClearAll(){ getFu().selectedClients = []; render(); }

// ─── Prepare: build each client's hanging-lead list ───
export async function fuPrepare(){
  const f = getFu();
  const names = [...selectedNames()];
  if(!names.length){ showToast('Select at least one client','error'); return; }
  const runId = (f.runId||0)+1; f.runId = runId;
  f.step='preparing';
  f.progress='Scanning Smartlead conversations for '+names.length+' client'+(names.length===1?'':'s')+'... (can take a minute)';
  f.rows=[];
  render();
  const stale = () => state.followup!==f || f.runId!==runId || f.step!=='preparing';
  try{
    // One client per request. A client with a lot of delivered leads means a
    // lot of Smartlead message-history calls, and batching every client into a
    // single invocation risks blowing the edge function's wall clock — one
    // slow client would then take the whole run down with it.
    const entries = [];
    for(let i=0;i<names.length;i++){
      if(stale()) return;
      f.progress = `Scanning Smartlead conversations — ${names[i]} (${i+1} of ${names.length})...`;
      render();
      try{
        const payload = await callFn({ action:'preview', client_names:[names[i]], template: currentTemplate() });
        entries.push(...Object.entries(payload.clients||{}));
      }catch(e){
        entries.push([names[i], { error: str(e.message) }]);
      }
    }
    if(stale()) return;
    f.rows = entries.map(([name,c])=>{
      const leads = c.leads || [];
      return {
        name,
        to: str(c.to), cc: (c.cc||[]).join(', '),
        first: str(c.first),
        threadFound: !!c.threadFound,
        leads,
        totalHanging: c.totalHanging != null ? c.totalHanging : leads.length,
        counts: c.counts || {},
        previewError: c.error ? str(c.error) : '',
        body: str(c.body) || DEFAULT_FOLLOWUP_TEMPLATE,
        // Nothing to chase → nothing to send. An empty reminder is worse than
        // no reminder: it trains them to ignore the whole series.
        include: leads.length>0 && !!c.to && !c.error,
        expanded: false, sendStatus:null, testStatus:null, error:''
      };
    }).sort((a,b)=> b.leads.length-a.leads.length || a.name.localeCompare(b.name));
    f.step='review';
  }catch(e){
    if(stale()) return;
    f.step='idle';
    showToast('Follow-up prep failed: '+e.message,'error');
  }
  render();
}

// ─── Send ───
export async function fuSendAll(){
  const f = getFu();
  const targets = f.rows.filter(r=>r.include && r.sendStatus!=='sent');
  if(!targets.length){ alert('No clients selected to send.'); return; }
  const preview = targets.map(r=>`• ${r.name} → ${r.to} (${r.leads.length} lead${r.leads.length===1?'':'s'})`).join('\n');
  if(!confirm(`Send ${targets.length} follow-up reminder${targets.length===1?'':'s'} now?\n\n${preview}\n\nSent from tim@theheadlinetheory.com on each client's "lead follow-ups" thread (CC aidan@ + client stakeholders).`)) return;
  f.step='sending';
  let sent=0, failed=0;
  for(const row of targets){
    row.sendStatus='sending'; render();
    try{
      const res = await callFn({ action:'send', client_name:row.name, body_text:row.body, leads:row.leads, total_hanging:row.totalHanging });
      row.sendStatus='sent'; row.threadId=res.threadId; sent++;
    }catch(e){
      row.sendStatus='failed'; row.error=str(e.message); failed++;
    }
    render();
  }
  f.step='done';
  const lastRun = { sentAt:new Date().toISOString(), sent, failed,
    clients: f.rows.filter(r=>r.sendStatus==='sent').map(r=>({ name:r.name, leads:r.leads.length })) };
  try{
    await sbSaveSettings({ followup_reminder_last_run: lastRun });
    state.savedSettings = { ...(state.savedSettings||{}), followup_reminder_last_run: lastRun };
  }catch(e){ /* history only */ }
  showToast(`Follow-up reminders: ${sent} sent${failed?`, ${failed} failed`:''}`, failed?'error':'success');
  render();
}

// Fire ONE row's current (edited) copy to Tim only — real lead list, real
// links, internal address, throwaway thread. The client thread is untouched.
export async function fuTestSend(i){
  const f = getFu();
  const row = f.rows[i];
  if(!row || row.testStatus==='sending') return;
  row.testStatus='sending'; render();
  try{
    await callFn({ action:'send', client_name:row.name, body_text:row.body, leads:row.leads, total_hanging:row.totalHanging, to_override:'tim@theheadlinetheory.com' });
    row.testStatus='sent';
    showToast(`Test reminder for ${row.name} sent to tim@theheadlinetheory.com (no client emailed)`,'success');
  }catch(e){
    row.testStatus='failed';
    showToast('Test send failed: '+str(e.message),'error');
  }
  render();
}

// ─── Template ───
export async function fuSaveTemplate(){
  const f = getFu();
  const v = str(f.tplDraft===null ? currentTemplate() : f.tplDraft);
  try{
    await sbSaveSettings({ followup_reminder_template: v });
    state.savedSettings = { ...(state.savedSettings||{}), followup_reminder_template: v };
    f.tplDraft=null; f.tplOpen=false;
    showToast('Follow-up template saved','success');
  }catch(e){ showToast('Template save failed: '+e.message,'error'); }
  render();
}
export function fuResetTemplate(){
  if(!confirm('Reset the follow-up reminder template to the default?')) return;
  getFu().tplDraft = DEFAULT_FOLLOWUP_TEMPLATE;
  render();
}
export function fuToggleLeads(i){
  const f = getFu();
  if(f.rows[i]) f.rows[i].expanded = !f.rows[i].expanded;
  render();
}

// ─── Rendering ───
const card = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-bottom:12px';
const btnP = 'class="btn btn-primary"';
const btnG = 'style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#f9fafb;color:#6b7280;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer"';

function ageLabel(d){
  if(d===null||d===undefined) return '';
  if(d<=0) return 'today';
  if(d===1) return 'yesterday';
  if(d<30) return d+' days ago';
  const m=Math.floor(d/30);
  return m===1?'about a month ago':'about '+m+' months ago';
}

function renderLeadList(row, i){
  if(!row.leads.length) return '';
  return `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);cursor:pointer" onclick="fuToggleLeads(${i})">
      ${row.expanded?'▲ hide':'▼ show'} the ${row.leads.length} lead${row.leads.length===1?'':'s'} in this email
    </div>
    ${row.expanded?`<div style="margin-top:8px;max-height:280px;overflow-y:auto">
      ${row.leads.map(l=>`<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
        <a href="${esc(l.link)}" target="_blank" rel="noopener" style="color:var(--purple);font-weight:600;text-decoration:none">${esc(l.company||l.email)}</a>
        <span style="color:var(--text-muted)"> · ${l.followUps===0?'never replied':'replied once'}${l.waitingOnClient?' · <strong style="color:#b45309">their reply is waiting</strong>':''}${l.daysSinceLast!=null?' · last message '+esc(ageLabel(l.daysSinceLast)):''}</span>
      </div>`).join('')}
    </div>`:''}
  </div>`;
}

function renderRow(r,i,f){
  const badge =
    r.sendStatus==='sent' ? `<span style="color:var(--green);font-weight:700;font-size:12px">✓ Sent</span>` :
    r.sendStatus==='sending' ? `<span style="color:var(--purple);font-weight:700;font-size:12px">Sending…</span>` :
    r.sendStatus==='failed' ? `<span style="color:var(--red);font-weight:700;font-size:12px" title="${esc(r.error)}">✗ Failed — ${esc(r.error).slice(0,80)}</span>` : '';
  const c = r.counts||{};
  const notes = [];
  if(c.scanned!=null) notes.push(`${c.scanned} conversations scanned`);
  if(c.errors) notes.push(`${c.errors} unreadable`);
  if(c.truncated) notes.push(`${c.truncated} beyond the scan cap — not included`);
  if(c.skippedNoIds) notes.push(`${c.skippedNoIds} without a Smartlead link`);

  return `<div style="${card};${r.include?'':'opacity:.55'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" ${r.include?'checked':''} ${(r.to&&r.leads.length&&f.step!=='sending')?'':'disabled'} style="width:16px;height:16px;accent-color:var(--purple);cursor:pointer"
          onchange="state.followup.rows[${i}].include=this.checked;render()">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(r.name)} ${badge}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">
            ${r.previewError?`<span style="color:var(--red);font-weight:600">${esc(r.previewError)}</span>`
              : r.to?`To: ${esc(r.to)} · CC: ${esc(r.cc||'none')} · ${r.threadFound?'↩ replies into the follow-ups thread':'✉ starts the follow-ups thread'}`
              : `<span style="color:var(--red);font-weight:600">No primary email — set it in Settings → Clients → Client Contact Info</span>`}
          </div>
        </div>
      </div>
      <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;background:${r.leads.length?'#7c3aed14':'#9ca3af14'};color:${r.leads.length?'#7c3aed':'#9ca3af'};font-size:12px;font-weight:700">${r.leads.length} in email${r.totalHanging>r.leads.length?` of ${r.totalHanging}`:''}</span>
    </div>
    ${notes.length?`<div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 0 26px">${esc(notes.join(' · '))}</div>`:''}
    <textarea rows="6" data-weekly-edit="1" ${f.step==='sending'?'disabled':''} style="width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
      oninput="state.followup.rows[${i}].body=this.value">${esc(r.body)}</textarea>
    <div style="font-size:10.5px;color:var(--text-muted);margin-top:4px">The lead list and Tim's signature are appended automatically below this copy.</div>
    ${renderLeadList(r,i)}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">
      ${r.testStatus==='sent'?`<span style="font-size:11px;color:var(--green);font-weight:600">✓ test sent to tim@</span>`:r.testStatus==='failed'?`<span style="font-size:11px;color:var(--red);font-weight:600">test failed — see toast</span>`:''}
      <button ${btnG} ${(f.step==='sending'||r.testStatus==='sending'||!r.leads.length)?'disabled':''} onclick="fuTestSend(${i})" title="Sends this exact copy + lead list to tim@theheadlinetheory.com only — no client is emailed.">${r.testStatus==='sending'?'Sending test…':'✉ Send test to Tim'}</button>
    </div>
  </div>`;
}

function renderTemplateEditor(f){
  const tplVal = f.tplDraft===null ? currentTemplate() : f.tplDraft;
  return `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="state.followup.tplOpen=!state.followup.tplOpen;render()">
      <div style="font-size:13px;font-weight:700;color:var(--text)">${svgIcon('settings',14)} Email Template</div>
      <span style="font-size:12px;color:var(--text-muted)">${f.tplOpen?'▲ collapse':'▼ edit'}</span>
    </div>
    ${f.tplOpen?`<div style="margin-top:12px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Placeholders: ${TOKENS.map(t=>`<code style="background:#f3f4f6;padding:1px 5px;border-radius:4px">${esc(t)}</code>`).join(' ')} — the lead list and Tim's signature are appended automatically, don't include them here.</div>
      <textarea rows="8" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
        oninput="state.followup.tplDraft=this.value">${esc(tplVal)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button ${btnP} onclick="fuSaveTemplate()">Save Template</button>
        <button ${btnG} onclick="fuResetTemplate()">Reset to Default</button>
      </div>
    </div>`:''}
  </div>`;
}

function renderClientSelect(f){
  const b64 = s => btoa(unescape(encodeURIComponent(str(s))));
  const clients = retainerClients();
  const sel = selectedNames();
  return `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">Reminders will be built for these retainer clients</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px"><strong>${clients.filter(c=>sel.has(c.name)).length}</strong> of ${clients.length} selected</div>
      </div>
      <div style="display:flex;gap:8px">
        <button ${btnG} onclick="fuSelectAll()">Select all</button>
        <button ${btnG} onclick="fuClearAll()">Clear all</button>
      </div>
    </div>
    <div style="margin-top:6px">
      ${clients.length?clients.map(c=>`<label style="display:flex;align-items:center;gap:9px;padding:7px 2px;border-top:1px solid var(--border);cursor:pointer">
        <input type="checkbox" ${sel.has(c.name)?'checked':''} style="width:15px;height:15px;accent-color:var(--purple);cursor:pointer"
          onchange="fuToggleClient(atob('${b64(c.name)}'))">
        <span style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(c.name)}</span>
        ${str(c.contactFirstName)?`<span style="font-size:11.5px;color:var(--text-muted)">· ${esc(str(c.contactFirstName))}</span>`:''}
      </label>`).join(''):`<div style="font-size:12px;color:var(--text-muted);padding:8px 2px">No active retainer clients found. Set Billing Model = Retainer in Settings → Clients.</div>`}
    </div>
  </div>`;
}

export function renderFollowupReminders(){
  const f = getFu();
  let html = `<div style="max-width:860px;margin:0 auto;padding:8px 20px 60px">`;

  if(f.step==='idle' || f.step==='preparing'){
    const lastRun = state.savedSettings?.followup_reminder_last_run;
    html += `<div style="${card}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">Lead Follow-Up Reminders</div>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px">
            For each retainer client, finds every delivered lead they've replied to <strong>at most once</strong> and emails them the list —
            each lead a direct link into that Smartlead conversation. Not limited to recent leads; an old one converts just as well.<br>
            Sent from tim@theheadlinetheory.com on each client's "lead follow-ups" thread. Recipients come from the CRM
            (Settings → Clients → Client Contact Info), same as Weekly Updates.
          </div>
          ${lastRun?`<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">Last run: ${lastRun.sent||0} sent${lastRun.failed?`, ${lastRun.failed} failed`:''} (${esc(str(lastRun.sentAt).slice(0,10))})</div>`:''}
        </div>
        <button ${btnP} ${f.step==='preparing'?'disabled':''} onclick="fuPrepare()">${svgIcon('send',14,'#fff')} ${f.step==='preparing'?'Preparing…':'Prepare Reminders'}</button>
      </div>
      ${f.step==='preparing'?`<div style="margin-top:12px;font-size:12.5px;color:var(--purple);font-weight:600">${esc(f.progress)}</div>`:''}
    </div>`;
    if(f.step==='idle') html += renderClientSelect(f);
    html += renderTemplateEditor(f);
  } else {
    const included = f.rows.filter(r=>r.include).length;
    const sentCount = f.rows.filter(r=>r.sendStatus==='sent').length;
    const failedCount = f.rows.filter(r=>r.sendStatus==='failed').length;
    const withLeads = f.rows.filter(r=>r.leads.length>0);
    const empty = f.rows.filter(r=>r.leads.length===0);
    const totalLeads = withLeads.reduce((n,r)=>n+r.leads.length,0);
    html += `<div style="${card};position:sticky;top:8px;z-index:50;box-shadow:0 4px 14px rgba(0,0,0,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--text)">${withLeads.length} client${withLeads.length===1?'':'s'} with leads to chase · ${totalLeads} lead${totalLeads===1?'':'s'} total</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            ${f.step==='done'?`Done: ${sentCount} sent${failedCount?`, ${failedCount} failed`:''}.`:`${included} selected to send.`}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button ${btnG} ${f.step==='sending'?'disabled':''} onclick="state.followup.step='idle';render()">← Back</button>
          ${f.step!=='done'?`<button ${btnP} ${f.step==='sending'?'disabled':''} onclick="fuSendAll()">${svgIcon('send',14,'#fff')} ${f.step==='sending'?'Sending…':`Send All (${included})`}</button>`:''}
        </div>
      </div>
    </div>`;
    html += withLeads.map(r=>renderRow(r,f.rows.indexOf(r),f)).join('');
    if(empty.length){
      html += `<div style="margin:18px 0 8px;font-size:12px;font-weight:700;color:var(--text-muted)">All caught up — nothing to chase</div>`;
      html += empty.map(r=>renderRow(r,f.rows.indexOf(r),f)).join('');
    }
  }

  html += `</div>`;
  return html;
}

// Inline-onclick handlers (app-wide convention)
window.fuPrepare = fuPrepare;
window.fuSendAll = fuSendAll;
window.fuTestSend = fuTestSend;
window.fuSaveTemplate = fuSaveTemplate;
window.fuResetTemplate = fuResetTemplate;
window.fuToggleClient = fuToggleClient;
window.fuSelectAll = fuSelectAll;
window.fuClearAll = fuClearAll;
window.fuToggleLeads = fuToggleLeads;
