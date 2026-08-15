// ═══════════════════════════════════════════════════════════
// MONTHLY UPDATES — Retainer month-in-review emails
// Drafts are created automatically on each client's BILLING DATE by the
//   monthly-update-cron edge fn (the billing day is the day-of-month of
//   clients.launch_date — "Launch Date (billing start)" in Settings).
//   This tab is the review-and-send step: nothing reaches a client until
//   someone here clicks send.
// Unlike Weekly Updates, drafts live in the DATABASE (CRM monthly_updates),
//   not localStorage — the cron has to know whether a month already went out,
//   and a per-browser draft can't tell it. Edits save straight to the row.
// Send: fulfillment `monthly-update-send` edge fn — sends FROM
//   lars@theheadlinetheory.com on each client's "<Client> monthly update"
//   thread (separate from the weekly thread). Recipients + Lars's signature
//   resolve exactly as they do for the weekly update.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260815171948';
import { state } from './app.js?v=20260815171948';
import { render } from './render.js?v=20260815171948';
import { showToast, sbSaveSettings } from './api.js?v=20260815171948';
import { esc, str, svgIcon } from './utils.js?v=20260815171948';

const SEND_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/monthly-update-send';

// One shared metrics block + a per-cohort closing, mirroring the edge fn's
// monthly-update-cron/template.ts. Keep the two in sync — the cron renders the
// draft, this editor is where the copy is changed.
const METRICS_BLOCK = `Hey {CLIENT_FIRST},

That's your {MONTH_WORD} month in the books.

Over {PERIOD} we sent {SENT} emails and got {POSITIVES} positive responses.`;

const CLOSINGS = {
  prepaid: `You're moving into month {NEXT_MONTH} now. Everything's already covered on your end, so there's nothing you need to do — we'll keep the campaigns running.

As always, let me know if you'd like to talk anything through.`,
  multi_month: `Looking forward to keeping the ball rolling. Month {NEXT_MONTH} kicks off now — the {AMOUNT} retainer is charged automatically, so there's nothing you need to do.

As always, let me know if you'd like to talk anything through.`,
  month_to_month: `Your retainer renews in {DAYS_UNTIL_RENEWAL} days. Nothing changes on your side unless you tell us otherwise — the {AMOUNT} renewal goes through on {RENEWAL_DATE}.

If you'd like to change anything before then, just let me know.`
};

export const AGREEMENT_TYPES = ['prepaid','multi_month','month_to_month'];
export const AGREEMENT_LABELS = {
  prepaid: 'Paid up front',
  multi_month: 'Auto-charged monthly',
  month_to_month: 'Month-to-month'
};
export function defaultMonthlyTemplate(t){
  return `${METRICS_BLOCK}\n\n${CLOSINGS[t] || CLOSINGS.prepaid}`;
}
export const DEFAULT_MONTHLY_UPDATE_TEMPLATE = defaultMonthlyTemplate('prepaid');

const MONTHLY_TOKENS = ['{CLIENT_FIRST}','{CLIENT_NAME}','{MONTH_WORD}','{MONTH_NUMBER}','{NEXT_MONTH}','{SENT}','{POSITIVES}','{REPLIES}','{PERIOD}','{AMOUNT}'];

// Same session-token contract as weekly-update-send: the edge fn URL is in this
// public repo, so it verifies the caller's CRM session before sending anything.
async function sendFn(payload){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(SEND_FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: JSON.stringify(payload) });
  const data = await resp.json().catch(()=>({ error:'monthly-update-send returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('monthly-update-send failed ('+resp.status+')'));
  return data;
}

function getMonthly(){
  if(!state.monthly) state.monthly = { step:'idle', rows:[], loaded:false, tplOpen:false, tplDraft:null, tplCohort:'prepaid' };
  return state.monthly;
}

function currentTemplate(cohort){
  const t = cohort || getMonthly().tplCohort || 'prepaid';
  return str(state.savedSettings?.['monthly_update_template_'+t]) || defaultMonthlyTemplate(t);
}

// ─── Load pending drafts ───
export async function monthlyLoad(){
  const m = getMonthly();
  m.step='loading'; render();
  try{
    const res = await sendFn({ action:'list' });
    const drafts = res.drafts || [];
    // Resolve recipients so the reviewer sees exactly who this lands on.
    let preview = { clients:{} };
    const names = [...new Set(drafts.map(d=>str(d.client_name)))];
    if(names.length){
      try{ preview = await sendFn({ action:'preview', client_names:names }); }catch(e){ /* non-fatal */ }
    }
    m.rows = drafts.map(d=>{
      const p = (preview.clients||{})[str(d.client_name)] || {};
      return {
        id: d.id,
        name: str(d.client_name),
        monthNumber: Number(d.month_number)||0,
        touch: Number(d.touch)||0,
        periodStart: str(d.period_start).slice(0,10),
        periodEnd: str(d.period_end).slice(0,10),
        sent: d.emails_sent, positives: d.positives, replies: d.replies,
        campaigns: Array.isArray(d.campaigns) ? d.campaigns : [],
        body: str(d.body_text),
        to: str(p.to), cc: (p.cc||[]).join(', '),
        threadFound: !!p.threadFound,
        previewError: p.error ? str(p.error) : '',
        include: !!str(p.to),
        dirty: false, saving:false, sendStatus:null, testStatus:null, error:''
      };
    }).sort((a,b)=>
      // Renewal notices outrank month-in-reviews (they expire), and within
      // them the 1-day notice is the most urgent.
      (b.touch>0) - (a.touch>0) || a.touch - b.touch ||
      b.periodEnd.localeCompare(a.periodEnd) || a.name.localeCompare(b.name));
    m.loaded = true;
    m.step = m.rows.length ? 'review' : 'empty';
  }catch(e){
    m.step='idle';
    showToast('Could not load monthly updates: '+e.message,'error');
  }
  render();
}

// ─── Body edits persist to the row (debounced) ───
let _saveTimer = null;
export function monthlyEdit(i, value){
  const m = getMonthly(); const row = m.rows[i]; if(!row) return;
  row.body = value; row.dirty = true;
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>monthlySaveBody(i), 900);
}

async function monthlySaveBody(i){
  const m = getMonthly(); const row = m.rows[i]; if(!row || !row.dirty) return;
  row.saving = true;
  try{
    const { error } = await supabase.from('monthly_updates')
      .update({ body_text: row.body }).eq('id', row.id);
    if(error) throw new Error(error.message);
    row.dirty = false;
  }catch(e){
    showToast('Draft save failed for '+row.name+': '+e.message,'error');
  }
  row.saving = false;
  render();
}

// ─── Send ───
export async function monthlySendAll(){
  const m = getMonthly();
  const targets = m.rows.filter(r=>r.include && r.sendStatus!=='sent');
  if(!targets.length){ alert('No clients selected to send.'); return; }
  const preview = targets.map(r=>`• ${r.name} (month ${r.monthNumber}) → ${r.to}`).join('\n');
  if(!confirm(`Send ${targets.length} monthly update${targets.length===1?'':'s'} now?\n\n${preview}\n\nSent from lars@theheadlinetheory.com on each client's "monthly update" thread. Each uses the copy for that client's agreement type — check the closing line of any client you're unsure about.`)) return;
  m.step='sending';
  let sent=0, failed=0;
  for(const row of targets){
    if(row.dirty) await monthlySaveBody(m.rows.indexOf(row));
    row.sendStatus='sending'; render();
    try{
      const res = await sendFn({ action:'send', update_id:row.id, body_text:row.body });
      row.sendStatus='sent'; row.threadId=res.threadId; sent++;
    }catch(e){
      row.sendStatus='failed'; row.error=str(e.message); failed++;
    }
    render();
  }
  m.step='done';
  showToast(`Monthly updates: ${sent} sent${failed?`, ${failed} failed`:''}`, failed?'error':'success');
  render();
}

export async function monthlyTestSend(i){
  const m = getMonthly(); const row = m.rows[i];
  if(!row || row.testStatus==='sending') return;
  row.testStatus='sending'; render();
  try{
    await sendFn({ action:'send', update_id:row.id, body_text:row.body, to_override:'lars@theheadlinetheory.com' });
    row.testStatus='sent';
    showToast(`Test copy for ${row.name} sent to lars@theheadlinetheory.com (no client emailed)`,'success');
  }catch(e){
    row.testStatus='failed';
    showToast('Test send failed: '+str(e.message),'error');
  }
  render();
}

export async function monthlySkip(i){
  const m = getMonthly(); const row = m.rows[i]; if(!row) return;
  if(!confirm(`Skip ${row.name}'s ${row.periodEnd} update?\n\nNo email is sent and this month will not come back.`)) return;
  try{
    await sendFn({ action:'skip', update_id:row.id });
    m.rows = m.rows.filter(r=>r.id!==row.id);
    if(!m.rows.length) m.step='empty';
    showToast(`${row.name} skipped`,'success');
  }catch(e){ showToast('Skip failed: '+e.message,'error'); }
  render();
}

// ─── Template editing (one per agreement type) ───
export function monthlyPickCohort(t){
  const m = getMonthly();
  if(m.tplCohort===t) return;
  if(m.tplDraft!==null && !confirm('Discard your unsaved changes to the '+AGREEMENT_LABELS[m.tplCohort]+' template?')) return;
  m.tplCohort = t; m.tplDraft = null;
  render();
}

export async function monthlySaveTemplate(){
  const m = getMonthly();
  const cohort = m.tplCohort || 'prepaid';
  const key = 'monthly_update_template_'+cohort;
  const v = str(m.tplDraft===null ? currentTemplate(cohort) : m.tplDraft);
  try{
    await sbSaveSettings({ [key]: v });
    state.savedSettings = { ...(state.savedSettings||{}), [key]: v };
    m.tplDraft=null;
    showToast(AGREEMENT_LABELS[cohort]+' template saved — applies to future drafts','success');
  }catch(e){ showToast('Template save failed: '+e.message,'error'); }
  render();
}

export function monthlyResetTemplate(){
  const m = getMonthly();
  const cohort = m.tplCohort || 'prepaid';
  if(!confirm('Reset the '+AGREEMENT_LABELS[cohort]+' template to the default?')) return;
  m.tplDraft = defaultMonthlyTemplate(cohort);
  render();
}

// ─── Rendering ───
const card = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-bottom:12px';
const btnP = 'class="btn btn-primary"';
const btnG = 'style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#f9fafb;color:#6b7280;font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer"';

function statChip(label,val,color){
  const shown = (val===null||val===undefined) ? '—' : val;
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;background:${color}14;color:${color};font-size:12px;font-weight:700">${shown} ${esc(label)}</span>`;
}

function renderTemplateEditor(m){
  const cohort = m.tplCohort || 'prepaid';
  const tplVal = m.tplDraft===null ? currentTemplate(cohort) : m.tplDraft;
  const tabCs = 'padding:5px 12px;font-size:11.5px;font-weight:600;font-family:var(--font);cursor:pointer;border:1px solid var(--border);border-radius:6px';
  return `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="state.monthly.tplOpen=!state.monthly.tplOpen;render()">
      <div style="font-size:13px;font-weight:700;color:var(--text)">${svgIcon('settings',14)} Email Template</div>
      <span style="font-size:12px;color:var(--text-muted)">${m.tplOpen?'▲ collapse':'▼ edit'}</span>
    </div>
    ${m.tplOpen?`
      <div style="margin-top:12px">
        <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">
          One template per agreement type — set a client's type in Settings → Clients → Retainer Billing.
          <strong>Only the closing paragraph should differ</strong>; the metrics wording is what the client compares against their weekly updates.
        </div>
        <div style="display:flex;gap:6px;margin-bottom:10px">
          ${AGREEMENT_TYPES.map(t=>`<button style="${tabCs};background:${cohort===t?'var(--purple)':'#f9fafb'};color:${cohort===t?'#fff':'var(--text-muted)'}"
            onclick="monthlyPickCohort('${t}')">${esc(AGREEMENT_LABELS[t])}</button>`).join('')}
        </div>
        ${cohort==='prepaid'?`<div style="font-size:11px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:7px 9px;margin-bottom:8px">These clients have already paid for the whole term — this copy must not mention charging, invoicing or payment.</div>`:''}
        ${cohort==='month_to_month'?`<div style="font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:7px 9px;margin-bottom:8px">Not sending yet — these clients are meant to get 7/3/1-day pre-renewal warnings, which aren't built. They're skipped by the drafter and reported in Slack.</div>`:''}
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Placeholders: ${MONTHLY_TOKENS.map(t=>`<code style="background:#f3f4f6;padding:1px 5px;border-radius:4px">${esc(t)}</code>`).join(' ')} — Lars's signature is appended automatically. Editing this affects FUTURE drafts, not the ones already built above.</div>
        <textarea rows="11" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
          oninput="state.monthly.tplDraft=this.value">${esc(tplVal)}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button ${btnP} onclick="monthlySaveTemplate()">Save ${esc(AGREEMENT_LABELS[cohort])} Template</button>
          <button ${btnG} onclick="monthlyResetTemplate()">Reset to Default</button>
        </div>
      </div>`:''}
  </div>`;
}

function renderRow(r,i,m){
  const badge =
    r.sendStatus==='sent' ? `<span style="color:var(--green);font-weight:700;font-size:12px">✓ Sent</span>` :
    r.sendStatus==='sending' ? `<span style="color:var(--purple);font-weight:700;font-size:12px">Sending…</span>` :
    r.sendStatus==='failed' ? `<span style="color:var(--red);font-weight:700;font-size:12px" title="${esc(r.error)}">✗ Failed — ${esc(r.error).slice(0,80)}</span>` : '';
  const saveState = r.saving ? '<span style="font-size:11px;color:var(--text-muted)">saving…</span>'
    : r.dirty ? '<span style="font-size:11px;color:#b45309">unsaved</span>'
    : '<span style="font-size:11px;color:var(--green)">saved</span>';
  const noMetrics = r.sent===null || r.sent===undefined;
  return `<div style="${card};${r.include?'':'opacity:.55'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" ${r.include?'checked':''} ${r.to&&m.step!=='sending'?'':'disabled'} style="width:16px;height:16px;accent-color:var(--purple);cursor:pointer"
          onchange="state.monthly.rows[${i}].include=this.checked;render()">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(r.name)} <span style="font-size:11px;font-weight:600;color:var(--purple);background:#f5f3ff;padding:2px 7px;border-radius:20px">Month ${r.monthNumber}</span>${r.touch>0?` <span style="font-size:11px;font-weight:700;color:#b45309;background:#fffbeb;border:1px solid #fde68a;padding:2px 7px;border-radius:20px" title="Month-to-month client: renewal notice. They are only charged once they say yes.">Renews in ${r.touch} day${r.touch===1?'':'s'}</span>`:''} ${badge}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">
            ${r.to?`<span>To: ${esc(r.to)}</span>${r.cc?` · <span>CC: ${esc(r.cc)}</span>`:''}`:`<span style="color:var(--red);font-weight:600">${r.previewError?esc(r.previewError):'No primary email — set it in Settings → Clients'}</span>`}
            · <span>${esc(r.periodStart)} → ${esc(r.periodEnd)}</span>
            · <span>${r.threadFound?'↩ replies into the monthly thread':'✉ starts the monthly thread'}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${r.touch===3||r.touch===1?`<span style="font-size:11.5px;color:var(--text-muted)">short nudge — no metrics by design</span>`:`${statChip('sent',r.sent,'#2563eb')}${statChip('replies',r.replies,'#d97706')}${statChip('positive',r.positives,'#059669')}`}
      </div>
    </div>
    ${noMetrics&&(r.touch===0||r.touch===7)?`<div style="margin:8px 0 0 26px;font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px">Smartlead metrics could not be pulled for this window — the numbers show as "—" in the copy. Fill them in by hand before sending.</div>`:''}
    ${r.campaigns.length?`<div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 0 26px">Campaigns: ${esc(r.campaigns.join(', '))}</div>`:''}
    <textarea rows="9" data-monthly-edit="1" ${m.step==='sending'?'disabled':''} style="width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box"
      oninput="monthlyEdit(${i},this.value)">${esc(r.body)}</textarea>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">
      ${saveState}
      ${r.testStatus==='sent'?`<span style="font-size:11px;color:var(--green);font-weight:600">✓ test sent to lars@</span>`:r.testStatus==='failed'?`<span style="font-size:11px;color:var(--red);font-weight:600">test failed — see toast</span>`:''}
      <button ${btnG} ${m.step==='sending'?'disabled':''} onclick="monthlySkip(${i})" title="No email is sent and this month will not reappear.">Skip this month</button>
      <button ${btnG} ${(m.step==='sending'||r.testStatus==='sending')?'disabled':''} onclick="monthlyTestSend(${i})" title="Sends this exact copy to lars@theheadlinetheory.com only — no client is emailed, and the month is not consumed.">${r.testStatus==='sending'?'Sending test…':'✉ Send test to Lars'}</button>
    </div>
  </div>`;
}

export function renderMonthlyUpdates(){
  const m = getMonthly();
  let html = `<div style="max-width:860px;margin:0 auto;padding:8px 20px 60px">`;

  const included = m.rows.filter(r=>r.include).length;
  const sentCount = m.rows.filter(r=>r.sendStatus==='sent').length;
  const failedCount = m.rows.filter(r=>r.sendStatus==='failed').length;

  html += `<div style="${card}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--text)">Monthly Retainer Updates</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px">
          Two kinds of draft land here. <strong>Month-in-review</strong> goes out on a client's billing date (the day-of-month of their Launch Date). <strong>Renewal notices</strong> go to month-to-month clients 7, 3 and 1 days before their renewal day — they're only charged once they reply, so these ask rather than tell.
          Review, edit and send — <strong>nothing goes to a client until you press send here</strong>. If a client has already replied, hit Skip.<br>
          Sent from lars@theheadlinetheory.com on each client's "monthly update" thread. Edits save to the draft as you type.
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button ${btnG} ${m.step==='loading'||m.step==='sending'?'disabled':''} onclick="monthlyLoad()">${m.step==='loading'?'Loading…':'↻ Refresh'}</button>
        ${m.rows.length&&m.step!=='done'?`<button ${btnP} ${m.step==='sending'?'disabled':''} onclick="monthlySendAll()">${svgIcon('send',14,'#fff')} ${m.step==='sending'?'Sending…':`Send All (${included})`}</button>`:''}
      </div>
    </div>
    ${m.step==='done'?`<div style="margin-top:10px;font-size:12.5px;color:${failedCount?'var(--red)':'var(--green)'};font-weight:600">Done: ${sentCount} sent${failedCount?`, ${failedCount} failed`:''}.</div>`:''}
  </div>`;

  if(m.step==='loading' && !m.rows.length){
    html += `<div style="text-align:center;padding:30px;color:var(--text-muted)">Loading drafts…</div>`;
  } else if(m.step==='empty' || (!m.rows.length && m.loaded)){
    html += `<div style="${card};text-align:center;color:var(--text-muted);font-size:13px;padding:28px">
      No monthly updates waiting.<br>
      <span style="font-size:12px">Drafts appear here automatically on a retainer client's billing date.</span>
    </div>`;
  } else if(!m.loaded){
    html += `<div style="${card};text-align:center;padding:24px">
      <button ${btnP} onclick="monthlyLoad()">Load pending updates</button>
    </div>`;
  } else {
    html += m.rows.map((r,i)=>renderRow(r,i,m)).join('');
  }

  html += renderTemplateEditor(m);
  html += `</div>`;
  return html;
}

// Inline-onclick handlers (app-wide convention)
window.monthlyLoad = monthlyLoad;
window.monthlyEdit = monthlyEdit;
window.monthlySendAll = monthlySendAll;
window.monthlyTestSend = monthlyTestSend;
window.monthlySkip = monthlySkip;
window.monthlyPickCohort = monthlyPickCohort;
window.monthlySaveTemplate = monthlySaveTemplate;
window.monthlyResetTemplate = monthlyResetTemplate;
