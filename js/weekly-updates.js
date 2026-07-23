// ═══════════════════════════════════════════════════════════
// WEEKLY UPDATES — Template-based end-of-week client emails
// Stats: fulfillment smartlead-proxy `weekly_client_stats` (Sat→today,
//   /sequence-analytics sums — the only accurate date-ranged endpoint).
// Send: fulfillment `weekly-update-send` edge fn — sends FROM
//   lars@theheadlinetheory.com via Gmail on dedicated "<Client> weekly
//   update" threads (first send starts the thread, later weeks reply into
//   it). Recipients from the CRM DB: TO = clients.notify_email
//   (edit in Settings → Clients → Client Contact Info), CC = aidan@ +
//   crm_settings.weekly_update_extra_ccs (editable per client below).
//   Lars's signature appended. The Client Info sheet is NOT used.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260724010617';
import { render } from './render.js?v=20260724010617';
import { showToast, sbSaveSettings } from './api.js?v=20260724010617';
import { esc, str, svgIcon } from './utils.js?v=20260724010617';

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
  if(!state.weekly) state.weekly = { step:'idle', rows:[], unmatched:[], statErrors:[], progress:'', tplOpen:false, tplDraft:null, rangeLabel:'', selectedClients:null, inactiveOpen:false };
  return state.weekly;
}

// ─── Idle-screen client selection (who gets drafts this run) ───
// selectedClients semantics: null/undefined = every active client is selected
// (so a newly-added client defaults in). The moment the user ticks/unticks
// anything we materialize an explicit array of client names. Names that no
// longer match a client are simply ignored downstream, so a roster change
// between sessions never breaks the run. An inactive client can also be ticked
// on — its name lands in the explicit array too. renderWeeklyUpdates()'s
// checklist AND weeklyPrepare()'s build filter BOTH resolve selection here, so
// they can never diverge.
function weeklySelectedNames(){
  const w = getWeekly();
  if(w.selectedClients==null) return new Set((state.clients||[]).filter(c=>c.status!=='inactive').map(c=>c.name));
  return new Set(w.selectedClients);
}
export function weeklyToggleClient(name){
  const w = getWeekly();
  const sel = weeklySelectedNames(); // materializes null → current active set
  if(sel.has(name)) sel.delete(name); else sel.add(name);
  w.selectedClients = [...sel];
  render();
}
export function weeklySelectAllClients(){
  getWeekly().selectedClients = null; // null = every active client (new ones default in)
  render();
}
export function weeklyClearClients(){
  getWeekly().selectedClients = []; // explicit empty = none selected
  render();
}
// Deactivate from the weekly checklist: defer to settings.js's global (confirm
// dialog + Supabase write + toast + revert-on-error), then — only if the client
// really is inactive now — drop the name from this run's explicit selection so
// a just-retired client can't linger ticked in the inactive section.
export async function weeklyDeactivateClient(clientId){
  await window.deactivateClient(clientId);
  const c = (state.clients||[]).find(x=>str(x.id)===str(clientId));
  if(!c || c.status!=='inactive') return; // confirm cancelled or write failed+reverted
  const w = getWeekly();
  if(Array.isArray(w.selectedClients)) w.selectedClients = w.selectedClients.filter(n=>n!==c.name);
  render();
}

function currentTemplate(){
  return str(state.savedSettings?.weekly_update_template) || DEFAULT_WEEKLY_UPDATE_TEMPLATE;
}

// The report week is the most recent COMPLETED Saturday → Friday week (local
// timezone). On a Friday that's the week ending today (send at EOD); any other
// day it's the week that ended last Friday.
// (Smartlead's per-day bucketing inside the range uses America/New_York,
// matching the campaign sending schedules.)
function weekRange(){
  // Report the most recent COMPLETED Saturday→Friday week. On a FRIDAY that's
  // the week ending TODAY: updates go out at EOD, after the day's sends are
  // done, so the numbers are final (weekend replies to Friday's emails land in
  // next week's count). Any other day reports the previous Sat→Fri week — the
  // current one isn't complete yet. Verified against the send cadence:
  // run Fri Jul 10 → Jul 4–Jul 10; run Sat Jul 11 → Jul 4–Jul 10.
  const now = new Date();
  const daysSinceSat = (now.getDay() + 1) % 7; // Sun=0..Sat=6 → Sat:0, Sun:1, ... Fri:6
  const curStart = new Date(now); curStart.setDate(now.getDate() - daysSinceSat); // Saturday of this week
  const start = new Date(curStart);
  if(now.getDay()!==5) start.setDate(curStart.getDate() - 7); // not Friday → previous week's Saturday
  const end = new Date(start); end.setDate(start.getDate() + 6); // that week's Friday
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const label = d => d.toLocaleDateString('en-US',{ month:'short', day:'numeric' });
  return { start: iso(start), end: iso(end), label: `${label(start)} – ${label(end)}` };
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
  // Honor the idle-screen selection — build only for the ticked clients.
  const sel = weeklySelectedNames();
  const runClients = (state.clients||[]).filter(c=>sel.has(c.name));
  if(!runClients.length){ showToast('Select at least one client','error'); return; }
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

    const byClient = {};
    for(const c of runClients) byClient[c.name] = { client:c, sent:0, replies:0, positives:0, campaigns:[] };
    for(const camp of campaigns){
      if(camp.error) continue;
      const n = str(camp.name).toLowerCase();
      const owner = runClients.find(c=>clientKeywords(c).some(k=>n.includes(k)));
      if(owner){
        const b = byClient[owner.name];
        b.sent += camp.sent||0; b.replies += camp.replies||0; b.positives += camp.positives||0;
        if(camp.sent>0) b.campaigns.push(camp.name);
      } else if((camp.sent||0) > 0){
        w.unmatched.push(`${camp.name} (${camp.sent} sent)`);
      }
    }

    w.progress='Resolving recipients...'; render();
    const names = Object.keys(byClient);
    const preview = await sendFn({ action:'preview', client_names: names });
    if(stale()) return;

    const tpl = currentTemplate();
    w.rows = names.map((name)=>{
      const b = byClient[name]; const p = (preview.clients||{})[name] || {};
      const first = str(p.first) || str(b.client.contactFirstName).trim().split(' ')[0] || 'there';
      const ccList = p.cc || [];
      // Clients with additional stakeholders CC'd on the email (anyone beyond
      // the internal @theheadlinetheory.com addresses like aidan@) get a
      // "Hey Team," greeting instead of one person's first name.
      const multiStakeholder = ccList.some(e => !str(e).toLowerCase().endsWith('@theheadlinetheory.com'));
      const greetName = multiStakeholder ? 'Team' : first;
      const row = {
        name, first, multiStakeholder, sent:b.sent, replies:b.replies, positives:b.positives, campaigns:b.campaigns,
        to: str(p.to), cc: ccList.join(', '), threadFound: !!p.threadFound,
        previewError: p.error ? str(p.error) : '',
        sendStatus: null, error: ''
      };
      row.body = applyWeeklyTemplate(tpl, { ...row, first: greetName, rangeLabel: range.label });
      row.include = b.sent>0 && !!row.to;
      return row;
    }).sort((a,b)=>b.sent-a.sent || a.name.localeCompare(b.name));

    w.step='review';
    saveDraftNow();
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
    saveDraftNow(); // persist sent/failed progress in case the tab dies mid-run
  }
  w.step='done';
  if(failed===0) clearDraft(); else saveDraftNow(); // clear only on a clean full send
  const lastRun = { range:w.rangeLabel, sentAt:new Date().toISOString(), sent, failed,
    clients: w.rows.filter(r=>r.sendStatus==='sent').map(r=>r.name) };
  try{
    await sbSaveSettings({ weekly_update_last_run: lastRun });
    state.savedSettings = { ...(state.savedSettings||{}), weekly_update_last_run: lastRun };
  }catch(e){ /* non-fatal — history only */ }
  showToast(`Weekly updates: ${sent} sent${failed?`, ${failed} failed`:''}`, failed?'error':'success');
  render();
}

// ─── Test send: fire ONE row's current (edited) body to Lars only ───
// Uses the edge fn's to_override test mode — restricted to an internal
// @theheadlinetheory.com address, a throwaway thread, no CC. The real client
// thread is never touched. Confirms the exact edited body_text transmits
// verbatim (frontend row.body → edge fn → Gmail), formatted as a client sees it.
export async function weeklyTestSend(i){
  const w = getWeekly();
  const row = w.rows[i];
  if(!row || row.testStatus==='sending') return;
  row.testStatus='sending'; render();
  try{
    await sendFn({ action:'send', client_name:row.name, body_text:row.body, to_override:'lars@theheadlinetheory.com' });
    row.testStatus='sent';
    showToast(`Test copy for ${row.name} sent to lars@theheadlinetheory.com (no client emailed)`, 'success');
  }catch(e){
    row.testStatus='failed';
    showToast('Test send failed: '+str(e.message), 'error');
  }
  render();
}

// ─── Draft autosave / restore (localStorage) ───
// state.weekly is in-memory only, so a reload/crash/tab-discard loses hand
// edits. We mirror the whole review state to localStorage (debounced on every
// edit) so it survives until you send. Restored from the idle screen.
const DRAFT_KEY = 'tht_weekly_draft';
const DRAFT_AT_KEY = 'tht_weekly_draft_at';
let _autosaveTimer = null;
function saveDraftNow(){
  try{
    const w = state.weekly;
    if(w && Array.isArray(w.rows) && w.rows.length){
      localStorage.setItem(DRAFT_KEY, JSON.stringify(w));
      localStorage.setItem(DRAFT_AT_KEY, new Date().toISOString());
    }
  }catch(e){ /* quota/serialize — non-fatal, the tab still has the live copy */ }
}
export function weeklyAutosave(){
  if(_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(saveDraftNow, 800);
}
function loadDraftMeta(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if(!raw) return null;
    const w = JSON.parse(raw);
    if(!w || !Array.isArray(w.rows) || !w.rows.length) return null;
    return { w, at: localStorage.getItem(DRAFT_AT_KEY) || '' };
  }catch(e){ return null; }
}
function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(DRAFT_AT_KEY); }catch(e){}
}
export function weeklyRestoreDraft(){
  const meta = loadDraftMeta();
  if(!meta){ showToast('No saved draft found in this browser.','error'); return; }
  const w = meta.w;
  // Coerce transient states so we land cleanly on the review screen.
  if(w.step==='preparing' || w.step==='idle' || w.step==='sending') w.step='review';
  w.runId = w.runId || 0;
  for(const r of w.rows){
    if(r.sendStatus==='sending') r.sendStatus=null;
    if(r.testStatus==='sending') r.testStatus=null;
  }
  state.weekly = w;
  render();
  showToast(`Restored ${w.rows.length} saved draft${w.rows.length===1?'':'s'} — review and send when ready.`,'success');
}
export function weeklyDiscardDraft(){
  if(!confirm('Discard the saved draft? Your written edits will be permanently removed from this browser.')) return;
  clearDraft();
  render();
  showToast('Saved draft discarded.','success');
}

// ─── Per-client CC editing (persists to crm_settings.weekly_update_extra_ccs) ───
export async function weeklyCcChange(i, value){
  const w = getWeekly(); const row = w.rows[i]; if(!row) return;
  const emails = str(value).split(/[,;\s]+/).map(e=>e.trim()).filter(e=>e.includes('@'));
  const extras = emails.filter(e=>{
    const x=e.toLowerCase();
    return x!=='aidan@theheadlinetheory.com' && x!=='lars@theheadlinetheory.com' && x!==str(row.to).toLowerCase();
  });
  row.cc = ['aidan@theheadlinetheory.com'].concat(extras).join(', ');
  saveDraftNow(); // keep the persisted draft's recipients in sync
  // Merge into the stored map (preserve entries for clients not in this run)
  const map = { ...(state.savedSettings?.weekly_update_extra_ccs || {}) };
  if(extras.length) map[row.name] = extras; else delete map[row.name];
  try{
    await sbSaveSettings({ weekly_update_extra_ccs: map });
    state.savedSettings = { ...(state.savedSettings||{}), weekly_update_extra_ccs: map };
    showToast('CCs saved for '+row.name,'success');
  }catch(e){ showToast('CC save failed: '+e.message,'error'); }
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
          onchange="state.weekly.rows[${i}].include=this.checked;weeklyAutosave()">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(r.name)} ${badge}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${sendable?`<span>To: ${esc(r.to)}</span><span>·</span><span>CC:</span><input value="${esc(r.cc)}" ${w.step==='sending'?'disabled':''} onchange="weeklyCcChange(${i},this.value)" title="Comma-separated. Saved per client for future weeks. aidan@ is always included." style="font-size:11.5px;font-family:var(--font);color:var(--text-secondary);border:1px solid var(--border);border-radius:6px;padding:2px 6px;min-width:280px;flex:1;max-width:420px">`:`<span style="color:var(--red);font-weight:600">${r.previewError?esc(r.previewError):'No primary email — set it in Settings → Clients → Client Contact Info'}</span>`}
            <span>·</span><span>${r.threadFound?'↩ replies into the weekly update thread':'✉ starts the weekly update thread'}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${statChip('sent',r.sent,'#2563eb')}${statChip('replies',r.replies,'#d97706')}${statChip('positive',r.positives,'#059669')}
      </div>
    </div>
    ${r.campaigns.length?`<div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 0 26px">Campaigns: ${esc(r.campaigns.join(', '))}</div>`:''}
    <textarea rows="7" data-weekly-edit="1" ${w.step==='sending'?'disabled':''} style="width:100%;margin-top:10px;${r.h?`height:${esc(r.h)};`:''}border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
      oninput="state.weekly.rows[${i}].body=this.value;weeklyAutosave()"
      onmouseup="if(this.style.height)state.weekly.rows[${i}].h=this.style.height">${esc(r.body)}</textarea>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">
      ${r.testStatus==='sent'?`<span style="font-size:11px;color:var(--green);font-weight:600">✓ test sent to lars@</span>`:r.testStatus==='failed'?`<span style="font-size:11px;color:var(--red);font-weight:600">test failed — see toast</span>`:''}
      <button ${btnG} ${(w.step==='sending'||r.testStatus==='sending')?'disabled':''} onclick="weeklyTestSend(${i})" title="Sends this exact (edited) copy to lars@theheadlinetheory.com only — no client is emailed. Confirms your edits transmit verbatim.">${r.testStatus==='sending'?'Sending test…':'✉ Send test to Lars'}</button>
    </div>
  </div>`;
}

// The idle-screen checklist of clients drafts will be built for. Rendered only
// while step==='idle' (hidden during 'preparing'). Reads/writes the same
// selection weeklyPrepare() consumes via weeklySelectedNames().
function renderWeeklyClientSelect(w){
  const b64 = s => btoa(unescape(encodeURIComponent(str(s))));
  const active = (state.clients||[]).filter(c=>c.status!=='inactive').slice().sort((a,b)=>str(a.name).localeCompare(str(b.name)));
  const inactive = (state.clients||[]).filter(c=>c.status==='inactive').slice().sort((a,b)=>str(a.name).localeCompare(str(b.name)));
  const sel = weeklySelectedNames();
  const selCount = active.filter(c=>sel.has(c.name)).length;
  const clientRow = c => {
    const contact = [str(c.contactFirstName).trim(), str(c.contactLastName).trim()].filter(Boolean).join(' ');
    // Status action writes through to the master clients table (same
    // deactivateClient/restoreClient globals as Settings → Clients, incl.
    // their confirm dialogs). Buttons inside the <label> must not toggle the
    // checkbox, hence preventDefault+stopPropagation.
    const action = c.status==='inactive'
      ? `<button style="margin-left:auto;flex-shrink:0;font-size:11px;font-weight:600;color:#059669;background:none;border:none;cursor:pointer;padding:2px 4px" title="Set back to active in the master clients table"
          onclick="event.preventDefault();event.stopPropagation();restoreClient('${esc(str(c.id))}')">Restore</button>`
      : `<button style="margin-left:auto;flex-shrink:0;font-size:11px;font-weight:600;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:2px 4px" title="Mark inactive in the master clients table — drops out of weekly updates from now on (restorable below or in Settings → Clients)"
          onclick="event.preventDefault();event.stopPropagation();weeklyDeactivateClient('${esc(str(c.id))}')">Make inactive</button>`;
    return `<label style="display:flex;align-items:center;gap:9px;padding:7px 2px;border-top:1px solid var(--border);cursor:pointer">
      <input type="checkbox" ${sel.has(c.name)?'checked':''} style="width:15px;height:15px;accent-color:var(--purple);cursor:pointer"
        onchange="weeklyToggleClient(atob('${b64(c.name)}'))">
      <span style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(c.name)}</span>
      ${contact?`<span style="font-size:11.5px;color:var(--text-muted)">· ${esc(contact)}</span>`:''}
      ${action}
    </label>`;
  };
  let html = `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">Drafts will be made for these clients</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px"><strong>${selCount}</strong> of ${active.length} client${active.length===1?'':'s'} selected</div>
      </div>
      <div style="display:flex;gap:8px">
        <button ${btnG} onclick="weeklySelectAllClients()">Select all</button>
        <button ${btnG} onclick="weeklyClearClients()">Clear all</button>
      </div>
    </div>
    <div style="margin-top:6px">
      ${active.length?active.map(clientRow).join(''):`<div style="font-size:12px;color:var(--text-muted);padding:8px 2px">No active clients found.</div>`}
    </div>`;
  if(inactive.length){
    const inactiveOn = inactive.filter(c=>sel.has(c.name)).length;
    html += `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="state.weekly.inactiveOpen=!state.weekly.inactiveOpen;render()">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted)">Other clients (inactive) — ${inactive.length}${inactiveOn?` · ${inactiveOn} included`:''}</div>
        <span style="font-size:12px;color:var(--text-muted)">${w.inactiveOpen?'▲ collapse':'▼ show'}</span>
      </div>
      ${w.inactiveOpen?`<div style="margin-top:4px">
        <div style="font-size:11px;color:var(--text-muted);padding:4px 2px">Tick one to include it in this run even though it's inactive.</div>
        ${inactive.map(clientRow).join('')}
      </div>`:''}
    </div>`;
  }
  html += `</div>`;
  return html;
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
            Pulls last week's Smartlead stats (<strong>${esc(range.label)}</strong>, the most recent completed Saturday→Friday week) for every active client,
            fills the template, and lets you review + customize each email before sending them all at once.<br>
            Sent from lars@theheadlinetheory.com on each client's "weekly update" thread. Recipients come from the CRM
            (primary email in Settings → Clients → Client Contact Info; CC = aidan@ + per-client extras, editable in the review list).
          </div>
          ${lastRun?`<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">Last run: ${esc(str(lastRun.range))} — ${lastRun.sent||0} sent${lastRun.failed?`, ${lastRun.failed} failed`:''} (${esc(str(lastRun.sentAt).slice(0,10))})</div>`:''}
        </div>
        <button ${btnP} ${w.step==='preparing'?'disabled':''} onclick="weeklyPrepare()">${svgIcon('send',14,'#fff')} ${w.step==='preparing'?'Preparing…':'Prepare Updates'}</button>
      </div>
      ${w.step==='preparing'?`<div style="margin-top:12px;font-size:12.5px;color:var(--purple);font-weight:600">${esc(w.progress)}</div>`:''}
    </div>`;
    if(w.step==='idle'){
      const draft = loadDraftMeta();
      if(draft){
        const n = draft.w.rows.length;
        const when = draft.at ? new Date(draft.at).toLocaleString('en-US',{ weekday:'short', hour:'numeric', minute:'2-digit' }) : 'earlier';
        html += `<div style="${card};border-color:var(--purple)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-size:13.5px;font-weight:800;color:var(--purple)">💾 Saved draft found — ${n} client${n===1?'':'s'}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Your edited copy from ${esc(when)}. Restore it instead of re-prepping — Prepare rebuilds every email from the template and discards edits.</div>
            </div>
            <div style="display:flex;gap:8px">
              <button ${btnP} onclick="weeklyRestoreDraft()">Restore saved drafts</button>
              <button ${btnG} onclick="weeklyDiscardDraft()">Discard</button>
            </div>
          </div>
        </div>`;
      }
      html += renderWeeklyClientSelect(w);
    }
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
      html += `<div style="margin:18px 0 8px;font-size:12px;font-weight:700;color:var(--text-muted)">Skipped — 0 sends that week (tick to include anyway)</div>`;
      html += zeroSend.map(r=>renderRow(r,w.rows.indexOf(r),w)).join('');
    }
  }

  html += `</div>`;
  return html;
}

// Inline-onclick handlers (app-wide convention)
window.weeklyPrepare = weeklyPrepare;
window.weeklySendAll = weeklySendAll;
window.weeklyTestSend = weeklyTestSend;
window.weeklyAutosave = weeklyAutosave;
window.weeklyRestoreDraft = weeklyRestoreDraft;
window.weeklyDiscardDraft = weeklyDiscardDraft;
window.weeklySaveTemplate = weeklySaveTemplate;
window.weeklyResetTemplate = weeklyResetTemplate;
window.weeklyCcChange = weeklyCcChange;
window.weeklyToggleClient = weeklyToggleClient;
window.weeklyDeactivateClient = weeklyDeactivateClient;
window.weeklySelectAllClients = weeklySelectAllClients;
window.weeklyClearClients = weeklyClearClients;
