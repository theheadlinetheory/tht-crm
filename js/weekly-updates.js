// ═══════════════════════════════════════════════════════════
// WEEKLY UPDATES — Template-based end-of-week client emails
// Stats: fulfillment smartlead-proxy `weekly_client_stats` (Sat→today,
//   /sequence-analytics sums — the only accurate date-ranged endpoint).
// Send: fulfillment `weekly-update-send` edge fn — sends FROM
//   lars@theheadlinetheory.com via Gmail on dedicated "<Client> weekly
//   update" threads (first send starts the thread, later weeks reply into
//   it). Recipients from the Client Info sheet: TO = Primary Contact
//   Email, CC = aidan@ + Other Contacts. Lars's signature appended.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260702e';
import { render } from './render.js?v=20260702e';
import { showToast, sbSaveSettings } from './api.js?v=20260702e';
import { esc, str, svgIcon } from './utils.js?v=20260702e';

// Both live on the fulfillment-dashboard Supabase project (verify_jwt=false)
const STATS_PROXY_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/smartlead-proxy';
const SEND_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/weekly-update-send';

async function sendFn(payload){
  const resp = await fetch(SEND_FN_URL,{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
  const data = await resp.json().catch(()=>({ error:'weekly-update-send returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('weekly-update-send failed ('+resp.status+')'));
  return data;
}

export const DEFAULT_WEEKLY_UPDATE_TEMPLATE = `Hey {CLIENT_FIRST},

Quick end of week update.

This week we sent {SENT} emails, got {REPLIES} responses, and {POSITIVES} positive responses. Still in talks with some of them to figure out meeting times.

Enjoy your weekend!`;

const WEEKLY_TOKENS = ['{CLIENT_FIRST}','{CLIENT_NAME}','{SENT}','{REPLIES}','{POSITIVES}','{WEEK_RANGE}'];

function getWeekly(){
  if(!state.weekly) state.weekly = { step:'idle', rows:[], unmatched:[], statErrors:[], progress:'', tplOpen:false, tplDraft:null, rangeLabel:'' };
  return state.weekly;
}

function currentTemplate(){
  return str(state.savedSettings?.weekly_update_template) || DEFAULT_WEEKLY_UPDATE_TEMPLATE;
}

// Most recent Saturday → today, in the user's local timezone. (Smartlead's
// per-day bucketing inside the range still uses America/New_York, matching
// the campaign sending schedules.)
function weekRange(){
  const now = new Date();
  const daysSinceSat = (now.getDay() + 1) % 7; // Sun=0..Sat=6 → Sat:0, Sun:1, ... Fri:6
  const start = new Date(now); start.setDate(now.getDate() - daysSinceSat);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const label = d => d.toLocaleDateString('en-US',{ month:'short', day:'numeric' });
  return { start: iso(start), end: iso(now), label: `${label(start)} – ${label(now)}` };
}

function applyWeeklyTemplate(tpl, ctx){
  let out = str(tpl);
  const map = {
    '{CLIENT_FIRST}': ctx.first || 'there',
    '{CLIENT_NAME}': ctx.name || '',
    '{SENT}': String(ctx.sent ?? 0),
    '{REPLIES}': String(ctx.replies ?? 0),
    '{POSITIVES}': String(ctx.positives ?? 0),
    '{WEEK_RANGE}': ctx.rangeLabel || ''
  };
  for(const [k,v] of Object.entries(map)) out = out.split(k).join(v);
  return out.trim();
}

function clientKeywords(c){
  return str(c.campaignKeywords||'').split(',')
    .concat(str(c.campaignName||'').split(','))
    .map(k=>k.trim().toLowerCase()).filter(Boolean);
}

// ─── Prepare: pull stats, match campaigns → clients, resolve recipients ───
export async function weeklyPrepare(){
  const w = getWeekly();
  const range = weekRange();
  const runId = (w.runId||0)+1; w.runId = runId; // Back/re-prep abandons stale in-flight runs
  w.step='preparing'; w.progress='Pulling Smartlead stats for '+range.label+'... (can take ~1 min)';
  w.rows=[]; w.unmatched=[]; w.statErrors=[]; w.rangeLabel=range.label; w.range=range;
  render();
  const stale = () => state.weekly!==w || w.runId!==runId || w.step!=='preparing';
  try{
    const pullStats = async () => {
      const resp = await fetch(STATS_PROXY_URL,{ method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ action:'weekly_client_stats', start_date: range.start, end_date: range.end }) });
      const payload = await resp.json().catch(()=>({ error:'Stats proxy returned a non-JSON response ('+resp.status+')' }));
      if(!resp.ok || payload.error) throw new Error(payload.error || ('Stats fetch failed ('+resp.status+')'));
      return payload;
    };
    let payload;
    try{
      payload = await pullStats();
    }catch(e){
      // Smartlead's shared rate cap gets bursty around the :00/:30 cache-sync
      // crons — one automatic retry after the window clears.
      if(stale()) return;
      w.progress='Smartlead rate-limit collision — retrying in 20s...'; render();
      await new Promise(r=>setTimeout(r,20000));
      if(stale()) return;
      w.progress='Retrying stats pull...'; render();
      payload = await pullStats();
    }
    if(stale()) return;
    const campaigns = payload.data || [];
    w.statErrors = campaigns.filter(c=>c.error).map(c=>c.name+': '+c.error);

    const activeClients = state.clients.filter(c=>c.status!=='inactive');
    const byClient = {};
    for(const c of activeClients) byClient[c.name] = { client:c, sent:0, replies:0, positives:0, campaigns:[] };
    for(const camp of campaigns){
      if(camp.error) continue;
      const n = str(camp.name).toLowerCase();
      const owner = activeClients.find(c=>clientKeywords(c).some(k=>n.includes(k)));
      if(owner){
        const b = byClient[owner.name];
        b.sent += camp.sent||0; b.replies += camp.replies||0; b.positives += camp.positives||0;
        if(camp.sent>0) b.campaigns.push(camp.name);
      } else if((camp.sent||0) > 0){
        w.unmatched.push(`${camp.name} (${camp.sent} sent)`);
      }
    }

    w.progress='Resolving recipients from the Client Info sheet...'; render();
    const names = Object.keys(byClient);
    const preview = await sendFn({ action:'preview', client_names: names });
    if(stale()) return;

    const tpl = currentTemplate();
    w.rows = names.map((name)=>{
      const b = byClient[name]; const p = (preview.clients||{})[name] || {};
      const first = str(p.first) || str(b.client.contactFirstName).trim().split(' ')[0] || 'there';
      const row = {
        name, first, sent:b.sent, replies:b.replies, positives:b.positives, campaigns:b.campaigns,
        to: str(p.to), cc: (p.cc||[]).join(', '), threadFound: !!p.threadFound,
        previewError: p.error ? str(p.error) : '',
        sendStatus: null, error: ''
      };
      row.body = applyWeeklyTemplate(tpl, { ...row, rangeLabel: range.label });
      row.include = b.sent>0 && !!row.to;
      return row;
    }).sort((a,b)=>b.sent-a.sent || a.name.localeCompare(b.name));

    w.step='review';
  }catch(e){
    if(stale()) return;
    w.step='idle';
    showToast('Weekly update prep failed: '+e.message,'error');
  }
  render();
}

// ─── Send all included rows sequentially ───
export async function weeklySendAll(){
  const w = getWeekly();
  const targets = w.rows.filter(r=>r.include && r.sendStatus!=='sent');
  if(!targets.length){ alert('No clients selected to send.'); return; }
  const preview = targets.map(r=>`• ${r.name} → ${r.to}`).join('\n');
  if(!confirm(`Send ${targets.length} weekly update email${targets.length===1?'':'s'} now?\n\n${preview}\n\nSent from lars@theheadlinetheory.com on each client's "weekly update" thread (CC aidan@ + client stakeholders). Your signature is appended automatically.`)) return;
  w.step='sending';
  let sent=0, failed=0;
  for(const row of targets){
    row.sendStatus='sending'; render();
    try{
      const res = await sendFn({ action:'send', client_name:row.name, body_text:row.body });
      row.sendStatus='sent'; row.threadId=res.threadId; sent++;
    }catch(e){
      row.sendStatus='failed'; row.error=str(e.message); failed++;
    }
    render();
  }
  w.step='done';
  const lastRun = { range:w.rangeLabel, sentAt:new Date().toISOString(), sent, failed,
    clients: w.rows.filter(r=>r.sendStatus==='sent').map(r=>r.name) };
  try{
    await sbSaveSettings({ weekly_update_last_run: lastRun });
    state.savedSettings = { ...(state.savedSettings||{}), weekly_update_last_run: lastRun };
  }catch(e){ /* non-fatal — history only */ }
  showToast(`Weekly updates: ${sent} sent${failed?`, ${failed} failed`:''}`, failed?'error':'success');
  render();
}

// ─── Template editing ───
export async function weeklySaveTemplate(){
  const w = getWeekly();
  const v = str(w.tplDraft===null ? currentTemplate() : w.tplDraft);
  try{
    await sbSaveSettings({ weekly_update_template: v });
    state.savedSettings = { ...(state.savedSettings||{}), weekly_update_template: v };
    w.tplDraft=null; w.tplOpen=false;
    showToast('Weekly update template saved','success');
  }catch(e){ showToast('Template save failed: '+e.message,'error'); }
  render();
}

export function weeklyResetTemplate(){
  if(!confirm('Reset the weekly update template to the default?')) return;
  const w = getWeekly();
  w.tplDraft = DEFAULT_WEEKLY_UPDATE_TEMPLATE;
  render();
}

// ─── Rendering ───
const card = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-bottom:12px';
const btnP = 'class="btn btn-primary"';
const btnG = 'style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#f9fafb;color:#6b7280;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer"';

function statChip(label,val,color){
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;background:${color}14;color:${color};font-size:12px;font-weight:700">${val} ${esc(label)}</span>`;
}

function renderTemplateEditor(w){
  const tplVal = w.tplDraft===null ? currentTemplate() : w.tplDraft;
  return `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="state.weekly.tplOpen=!state.weekly.tplOpen;render()">
      <div style="font-size:13px;font-weight:700;color:var(--text)">${svgIcon('settings',14)} Email Template</div>
      <span style="font-size:12px;color:var(--text-muted)">${w.tplOpen?'▲ collapse':'▼ edit'}</span>
    </div>
    ${w.tplOpen?`
      <div style="margin-top:12px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Placeholders: ${WEEKLY_TOKENS.map(t=>`<code style="background:#f3f4f6;padding:1px 5px;border-radius:4px">${esc(t)}</code>`).join(' ')} — Lars's signature is appended automatically, don't include it here.</div>
        <textarea rows="9" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
          oninput="state.weekly.tplDraft=this.value">${esc(tplVal)}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button ${btnP} onclick="weeklySaveTemplate()">Save Template</button>
          <button ${btnG} onclick="weeklyResetTemplate()">Reset to Default</button>
        </div>
      </div>`:''}
  </div>`;
}

function renderRow(r,i,w){
  const sendable = !!r.to;
  const badge =
    r.sendStatus==='sent' ? `<span style="color:var(--green);font-weight:700;font-size:12px">✓ Sent</span>` :
    r.sendStatus==='sending' ? `<span style="color:var(--purple);font-weight:700;font-size:12px">Sending…</span>` :
    r.sendStatus==='failed' ? `<span style="color:var(--red);font-weight:700;font-size:12px" title="${esc(r.error)}">✗ Failed — ${esc(r.error).slice(0,80)}</span>` : '';
  return `<div style="${card};${r.include?'':'opacity:.55'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" ${r.include?'checked':''} ${sendable&&w.step!=='sending'?'':'disabled'} style="width:16px;height:16px;accent-color:var(--purple);cursor:pointer"
          onchange="state.weekly.rows[${i}].include=this.checked">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(r.name)} ${badge}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">
            ${sendable?`To: ${esc(r.to)} &nbsp;·&nbsp; CC: ${esc(r.cc)}`:`<span style="color:var(--red);font-weight:600">No recipient — check the client's row in the Client Info sheet</span>`}
            &nbsp;·&nbsp; ${r.threadFound?'↩ replies into the weekly update thread':'✉ starts the weekly update thread'}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${statChip('sent',r.sent,'#2563eb')}${statChip('replies',r.replies,'#d97706')}${statChip('positive',r.positives,'#059669')}
      </div>
    </div>
    ${r.campaigns.length?`<div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 0 26px">Campaigns: ${esc(r.campaigns.join(', '))}</div>`:''}
    ${r.previewError?`<div style="font-size:11px;color:var(--red);margin:6px 0 0 26px">Recipient preview failed: ${esc(r.previewError)}</div>`:''}
    <textarea rows="7" ${w.step==='sending'?'disabled':''} style="width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
      oninput="state.weekly.rows[${i}].body=this.value">${esc(r.body)}</textarea>
  </div>`;
}

export function renderWeeklyUpdates(){
  const w = getWeekly();
  const range = weekRange();
  let html = `<div style="max-width:860px;margin:0 auto;padding:8px 20px 60px">`;

  if(w.step==='idle' || w.step==='preparing'){
    const lastRun = state.savedSettings?.weekly_update_last_run;
    html += `<div style="${card}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">Weekly Client Updates</div>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px">
            Pulls this week's Smartlead stats (<strong>${esc(range.label)}</strong>, Saturday→today) for every active client,
            fills the template, and lets you review + customize each email before sending them all at once.<br>
            Sent from lars@theheadlinetheory.com on each client's "weekly update" thread (CC aidan@ + client stakeholders from the Client Info sheet).
          </div>
          ${lastRun?`<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">Last run: ${esc(str(lastRun.range))} — ${lastRun.sent||0} sent${lastRun.failed?`, ${lastRun.failed} failed`:''} (${esc(str(lastRun.sentAt).slice(0,10))})</div>`:''}
        </div>
        <button ${btnP} ${w.step==='preparing'?'disabled':''} onclick="weeklyPrepare()">${svgIcon('send',14,'#fff')} ${w.step==='preparing'?'Preparing…':'Prepare Updates'}</button>
      </div>
      ${w.step==='preparing'?`<div style="margin-top:12px;font-size:12.5px;color:var(--purple);font-weight:600">${esc(w.progress)}</div>`:''}
    </div>`;
    html += renderTemplateEditor(w);
  } else {
    const included = w.rows.filter(r=>r.include).length;
    const sentCount = w.rows.filter(r=>r.sendStatus==='sent').length;
    const failedCount = w.rows.filter(r=>r.sendStatus==='failed').length;
    const withSends = w.rows.filter(r=>r.sent>0);
    const zeroSend = w.rows.filter(r=>r.sent===0);
    html += `<div style="${card};position:sticky;top:8px;z-index:50;box-shadow:0 4px 14px rgba(0,0,0,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--text)">Week ${esc(w.rangeLabel)} — ${withSends.length} client${withSends.length===1?'':'s'} with sends, ${zeroSend.length} skipped (0 sends)</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            ${w.step==='done'?`Done: ${sentCount} sent${failedCount?`, ${failedCount} failed`:''}.`:`${included} selected to send.`}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button ${btnG} ${w.step==='sending'?'disabled':''} onclick="state.weekly.step='idle';render()">← Back</button>
          ${w.step!=='done'?`<button ${btnP} ${w.step==='sending'?'disabled':''} onclick="weeklySendAll()">${svgIcon('send',14,'#fff')} ${w.step==='sending'?'Sending…':`Send All (${included})`}</button>`:''}
        </div>
      </div>
      ${w.unmatched.length?`<div style="margin-top:8px;font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px"><strong>Unmatched campaigns with sends</strong> (no active client's keywords match — add keywords in Settings → Clients): ${esc(w.unmatched.join(' · '))}</div>`:''}
      ${w.statErrors.length?`<div style="margin-top:8px;font-size:11.5px;color:var(--red)">Stats errors: ${esc(w.statErrors.join(' · '))}</div>`:''}
    </div>`;
    html += withSends.map(r=>renderRow(r,w.rows.indexOf(r),w)).join('');
    if(zeroSend.length){
      html += `<div style="margin:18px 0 8px;font-size:12px;font-weight:700;color:var(--text-muted)">Skipped — 0 sends this week (tick to include anyway)</div>`;
      html += zeroSend.map(r=>renderRow(r,w.rows.indexOf(r),w)).join('');
    }
  }

  html += `</div>`;
  return html;
}

// Inline-onclick handlers (app-wide convention)
window.weeklyPrepare = weeklyPrepare;
window.weeklySendAll = weeklySendAll;
window.weeklySaveTemplate = weeklySaveTemplate;
window.weeklyResetTemplate = weeklyResetTemplate;
