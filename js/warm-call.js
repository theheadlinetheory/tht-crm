// ═══════════════════════════════════════════════════════════
// WARM-CALL — Warm call sheet overlay
// ═══════════════════════════════════════════════════════════
//
// Full warm call overlay with maps, Calendly inline, property view,
// schedule prompt, and warm call Q&A.

import { state, pendingWrites } from './app.js';
import { render, refreshModal } from './render.js';
import { invokeEdgeFunction } from './api.js';
import { esc, str, svgIcon, getToday, isValidDate, fmtDate, fmtTime12, uid } from './utils.js';
import { findClientForDeal, lookupClientInfo, getWarmCallQA } from './client-info.js';
import { isAdmin, isEmployee } from './auth.js';

export function openWarmCallSheet(dealId){
  try{
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal){console.error('openWarmCallSheet: deal not found',dealId);return;}
  const mc=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  if(!mc){console.error('openWarmCallSheet: client not found for deal',deal.stage);return;}
  const info=lookupClientInfo(mc.name)||{};
  const { copyToClipboard } = window;
  const { clientIanaTz, savePrefillField } = window;

  const now=new Date();
  const clientNameLower=mc.name.toLowerCase();

  function parseBookedDate(dateStr, timeStr){
    if(!dateStr) return null;
    const bd=String(dateStr).trim();
    let dt;
    if(/^\d{4}-\d{2}-\d{2}$/.test(bd)){
      dt=new Date(bd+'T'+(timeStr||'23:59'));
    } else {
      dt=new Date(bd);
      if(!isNaN(dt.getTime()) && timeStr){
        const[hh,mm]=(timeStr||'').split(':');
        if(hh) dt.setHours(parseInt(hh),parseInt(mm||'0'));
      }
    }
    return (dt && !isNaN(dt.getTime())) ? dt : null;
  }

  function fuzzyClientMatch(name){
    const n=String(name||'').toLowerCase();
    return n===clientNameLower || clientNameLower.includes(n) || n.includes(clientNameLower);
  }

  const dealMeetings=state.deals.filter(d=>{
    const dt=parseBookedDate(d.bookedDate, d.bookedTime);
    if(!dt || dt<now) return false;
    return fuzzyClientMatch(d.stage);
  }).map(d=>({
    name: d.company||d.contact||'Unknown',
    date: d.bookedDate,
    time: d.bookedTime||'',
    parsed: parseBookedDate(d.bookedDate, d.bookedTime),
    dealId: d.id
  }));

  const apptMeetings=(state.appointments||[]).filter(a=>{
    const dt=parseBookedDate(a.apptDate, a.apptTime);
    if(!dt || dt<now) return false;
    return fuzzyClientMatch(a.clientName);
  }).map(a=>({
    name: a.leadName||'Unknown',
    date: a.apptDate,
    time: a.apptTime||'',
    parsed: parseBookedDate(a.apptDate, a.apptTime),
    dealId: null
  }));

  const seenKeys=new Set();
  const upcoming=[...dealMeetings,...apptMeetings].filter(m=>{
    const key=(m.name+m.date+m.time).toLowerCase();
    if(seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  }).sort((a,b)=>a.parsed-b.parsed).slice(0,10);

  const replyText=str(deal.emailBody||'').trim();
  const leadPhone=deal.phone?String(deal.phone).replace(/[^0-9+]/g,''):'';
  const leadMobile=deal.mobilePhone?String(deal.mobilePhone).replace(/[^0-9+]/g,''):'';
  const TODAY=getToday;

  let h=`<div id="warm-call-overlay" style="position:fixed;inset:0;z-index:100000;background:#f8fafc;overflow-y:auto;animation:fadeIn .2s ease">
    <div style="max-width:1100px;margin:0 auto;padding:20px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #e2e8f0">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e"></div>
          <h2 style="margin:0;font-size:20px;color:#1e293b">Warm Call Sheet</h2>
        </div>
        <button onclick="document.getElementById('warm-call-overlay').remove()" style="padding:8px 20px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;cursor:pointer;font-size:13px;font-weight:600">Close</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
            <div style="background:#059669;padding:12px 16px;color:#fff">
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:.8">Our Client</div>
              <div style="font-size:18px;font-weight:700;margin-top:2px">${esc(mc.name)}</div>
            </div>
            <div style="padding:16px">
              <div style="display:grid;gap:12px">
                ${info.primaryContact?`<div>
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Point of Contact</div>
                  <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:2px">${esc(info.primaryContact)}</div>
                  ${info.primaryEmail?`<div style="display:flex;align-items:center;gap:6px;margin-top:1px">
                    <span style="font-size:12px;color:#6b7280">${esc(info.primaryEmail)}</span>
                    <button onclick="event.stopPropagation();copyToClipboard('${esc(info.primaryEmail)}',this)" style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-weight:600">Copy</button>
                  </div>`:''}
                  ${info.phone?`<div style="font-size:12px;color:#6b7280;margin-top:1px">${esc(info.phone)}</div>`:''}
                </div>`:''}

                ${info.forwardEmail&&info.forwardEmail!==info.primaryEmail?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Forward Leads To</div>
                  <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:2px">${esc(info.forwardName||info.primaryContact||'')}</div>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:1px">
                    <span style="font-size:12px;color:#6b7280">${esc(info.forwardEmail)}</span>
                    <button onclick="event.stopPropagation();copyToClipboard('${esc(info.forwardEmail)}',this)" style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-weight:600">Copy</button>
                  </div>
                </div>`:''}

                <div style="border-top:1px solid #f1f5f9;padding-top:12px">
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Location & Service Area</div>
                  <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:2px">${esc(info.location||'\u2014')}</div>
                  ${info.timeZone?`<div style="font-size:11px;color:#6b7280;margin-top:1px">Timezone: ${esc(info.timeZone)}</div>`:''}
                  ${info.serviceAreaCities?`<div style="font-size:12px;color:#374151;margin-top:4px">${esc(info.serviceAreaCities)}</div>`:''}
                </div>

                ${info.services&&info.services.length?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Services Offered</div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px">
                    ${info.services.map(s=>`<span style="font-size:11px;background:#ecfdf5;color:#065f46;padding:3px 8px;border-radius:4px;border:1px solid #d1fae5">${esc(s)}</span>`).join('')}
                  </div>
                </div>`:''}

                ${info.website?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Website</div>
                  <a href="${esc(info.website)}" target="_blank" rel="noopener" style="font-size:12px;color:#2563eb;text-decoration:none">${esc(info.website)}</a>
                </div>`:''}

                ${(()=>{
                  const savedText=str(mc.warmCallNotesText).trim();
                  const notes=savedText?savedText.split('\n').filter(l=>l.trim()):(info.warmCallNotes||[]);
                  if(!notes.length) return '';
                  return `<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                  <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">SDR Quick Reference</div>
                  <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px">
                    ${notes.map(n=>'<li style="font-size:12px;color:#374151;line-height:1.5">'+esc(n)+'</li>').join('')}
                  </ul>
                </div>`;
                })()}
              </div>
            </div>
          </div>

          <div style="background:#fff;border-radius:12px;border:2px solid #f59e0b;overflow:hidden">
            <div style="background:#f59e0b;padding:10px 16px;color:#fff;display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:13px;font-weight:700">${esc(mc.name)}'s Schedule</div>
              ${info.timeZone?`<div style="font-size:11px;font-weight:600;background:rgba(255,255,255,.25);padding:2px 8px;border-radius:10px">${esc(info.timeZone)}</div>`:''}
            </div>
            <div style="padding:12px 16px">
              ${upcoming.length?`
                ${upcoming.map(m=>{
                  const dateStr=m.parsed.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
                  const timeStr=m.time?m.parsed.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
                  const isToday=m.date===TODAY();
                  const isThisDeal=m.dealId===deal.id;
                  return `<div style="font-size:13px;color:#374151;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;border-radius:6px;${isToday?'background:#fef3c7;':''}${isThisDeal?'background:#dbeafe;':''}">
                    <span style="font-weight:500">${esc(m.name)}${isThisDeal?' <span style="font-size:10px;color:#3b82f6;font-weight:700">(this lead)</span>':''}</span>
                    <span style="font-weight:700;color:#b45309;white-space:nowrap">${dateStr} @ ${timeStr||'TBD'}</span>
                  </div>`;
                }).join('')}
              `:`<div style="font-size:13px;color:#9ca3af;text-align:center;padding:8px 0">No upcoming meetings \u2014 calendar is open</div>`}
            </div>
          </div>

          ${(()=>{
            const calUrl=str(mc.calendlyUrl).trim();
            if(!calUrl||!/^https?:\/\/.+/.test(calUrl.includes('://')?calUrl:'https://'+calUrl)) return '';
            let _cu;try{_cu=new URL(calUrl.includes('://')?calUrl:'https://'+calUrl);}catch(e){return '';}
            const wcPrefillLines=[];
            if(deal.company) wcPrefillLines.push('Business: '+deal.company);
            if(deal.website) wcPrefillLines.push('Website: '+deal.website);
            const wcCalAddr=str(deal.address||deal.location||'').trim();
            if(wcCalAddr) wcPrefillLines.push('Address: '+wcCalAddr);
            if(deal.email) wcPrefillLines.push('Email: '+deal.email);
            if(deal.email2) wcPrefillLines.push('Contact email: '+deal.email2);
            if(deal.phone) wcPrefillLines.push('Business Phone: '+deal.phone);
            if(deal.contact && deal.contact!==deal.company) wcPrefillLines.push('Contact: '+deal.contact);
            if(deal.mobilePhone) wcPrefillLines.push('Mobile Phone: '+deal.mobilePhone);
            wcPrefillLines.push('Instructions: ');
            const wcNameVal=deal.calName!=null?deal.calName:(deal.contact||deal.company||'');
            const wcEmailVal=deal.calEmail!=null?deal.calEmail:(deal.email||'');
            const wcNotesVal=deal.calNotes!=null?deal.calNotes:wcPrefillLines.join('\n');
            if(wcNameVal) _cu.searchParams.set('name',wcNameVal);
            if(wcEmailVal) _cu.searchParams.set('email',wcEmailVal);
            if(wcNotesVal) _cu.searchParams.set('a1',wcNotesVal);
            const { clientIanaTz: cIanaTz } = require_calendly_sync();
            const ianaTz=cIanaTz(mc.name);
            if(ianaTz) _cu.searchParams.set('timezone',ianaTz);
            return `<div style="background:#fff;border-radius:12px;border:2px solid #7c3aed;overflow:hidden">
              <div style="background:#7c3aed;padding:8px 16px;display:flex;justify-content:space-between;align-items:center">
                <div style="font-size:13px;font-weight:700;color:#fff">${svgIcon('calendar',14,'#fff')} Book on ${esc(mc.name)}'s Calendar</div>
                <button onclick="document.getElementById('wc-cal-prefill-toggle').style.display=document.getElementById('wc-cal-prefill-toggle').style.display==='none'?'block':'none'" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;font-weight:600">Edit Guest Info</button>
              </div>
              <div id="wc-cal-prefill-toggle" style="display:none;padding:10px 16px;border-bottom:1px solid #e2e8f0;background:#f5f3ff">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
                  <div>
                    <label style="font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Guest Name</label>
                    <input type="text" id="wc-cal-prefill-name" value="${esc(wcNameVal)}"
                      oninput="savePrefillField('${esc(deal.id)}','calName',this.value);refreshWcCalendlyInline()"
                      style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px;font-family:var(--font);margin-top:2px">
                  </div>
                  <div>
                    <label style="font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Guest Email</label>
                    <input type="text" id="wc-cal-prefill-email" value="${esc(wcEmailVal)}"
                      oninput="savePrefillField('${esc(deal.id)}','calEmail',this.value);refreshWcCalendlyInline()"
                      style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:12px;font-family:var(--font);margin-top:2px">
                  </div>
                </div>
                <div>
                  <label style="font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Additional Info</label>
                  <textarea id="wc-cal-prefill-notes" rows="2"
                    oninput="savePrefillField('${esc(deal.id)}','calNotes',this.value);refreshWcCalendlyInline()"
                    style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;font-family:var(--font);margin-top:2px;resize:vertical">${esc(wcNotesVal)}</textarea>
                </div>
              </div>
              <div id="wc-calendly-inline" data-deal-id="${esc(deal.id)}" data-base-url="${esc(calUrl)}" data-client="${esc(mc.name)}" style="min-height:500px;height:500px;overflow:hidden"></div>
            </div>`;
          })()}
        </div>

        <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
          <div style="background:#3b82f6;padding:12px 16px;color:#fff">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:.8">The Lead</div>
            <div style="font-size:18px;font-weight:700;margin-top:2px">${esc(deal.company||deal.contact||'Unknown')}</div>
          </div>
          <div style="padding:16px">
            <div style="display:grid;gap:12px">
              <div>
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Contact</div>
                <div style="font-size:14px;font-weight:600;color:#1e293b;margin-top:2px">${esc(deal.contact||'\u2014')}</div>
                ${deal.email?`<div style="display:flex;align-items:center;gap:6px;margin-top:1px">
                  <span style="font-size:12px;color:#6b7280">${esc(deal.email)}</span>
                  <button onclick="event.stopPropagation();copyToClipboard('${esc(deal.email)}',this)" style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-weight:600">Copy</button>
                </div>`:''}
                ${[deal.email2,deal.email3,deal.email4].filter(e=>e&&str(e).trim()).map(e=>`<div style="display:flex;align-items:center;gap:6px;margin-top:1px">
                  <span style="font-size:12px;color:#6b7280">${esc(e)}</span>
                  <button onclick="event.stopPropagation();copyToClipboard('${esc(e)}',this)" style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-weight:600">Copy</button>
                </div>`).join('')}
              </div>

              ${deal.phone||deal.mobilePhone?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Phone</div>
                ${deal.phone?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <span style="font-size:13px;font-weight:600;color:#1e293b">${esc(deal.phone)}</span>
                  <span style="font-size:10px;color:#9ca3af">Business</span>
                  <a href="tel:${leadPhone}" style="font-size:11px;color:#2563eb;text-decoration:none;font-weight:600">Call</a>
                </div>`:''}
                ${deal.mobilePhone?`<div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:13px;font-weight:600;color:#1e293b">${esc(deal.mobilePhone)}</span>
                  <span style="font-size:10px;color:#9ca3af">Mobile</span>
                  <a href="tel:${leadMobile}" style="font-size:11px;color:#2563eb;text-decoration:none;font-weight:600">Call</a>
                </div>`:''}
              </div>`:''}

              ${deal.location?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Address</div>
                <div style="font-size:13px;font-weight:600;color:#1e293b;margin-top:2px">${esc(deal.location)}</div>
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str(deal.address||deal.location||''))}" target="_blank" rel="noopener"
                  style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:11px;color:#fff;background:#4285f4;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600">
                  Open in Google Maps
                </a>
              </div>`:''}

              ${deal.website?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Website</div>
                <a href="${esc(deal.website.match(/^https?:\/\//)?deal.website:'https://'+deal.website)}" target="_blank" rel="noopener" style="font-size:12px;color:#2563eb;text-decoration:none">${esc(deal.website)}</a>
              </div>`:''}

              ${deal.campaignName?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Campaign</div>
                <div style="font-size:12px;color:#374151;margin-top:2px">${esc(deal.campaignName)}</div>
                ${deal.leadCategory?`<div style="font-size:11px;color:#059669;font-weight:600;margin-top:2px">Category: ${esc(deal.leadCategory)}</div>`:''}
              </div>`:''}

              ${replyText?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Their Reply / Why They Reached Out</div>
                <div style="font-size:12px;color:#374151;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0;line-height:1.6;white-space:pre-wrap;max-height:200px;overflow-y:auto">${esc(replyText)}</div>
              </div>`:''}

              ${deal.notes?`<div style="border-top:1px solid #f1f5f9;padding-top:12px">
                <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">Notes</div>
                <div style="font-size:12px;color:#374151;margin-top:2px;line-height:1.5">${esc(deal.notes)}</div>
              </div>`:''}
            </div>
          </div>

          ${(()=>{
            const propAddr=str(deal.address||deal.location||'').trim();
            if(!propAddr) return '';
            return `<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-top:16px">
              <div style="background:#334155;padding:10px 16px;color:#fff;display:flex;justify-content:space-between;align-items:center">
                <div style="font-size:13px;font-weight:700">Property View</div>
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(propAddr)}" target="_blank" rel="noopener" style="font-size:10px;color:#93c5fd;text-decoration:none;font-weight:600">Open Full Map &rarr;</a>
              </div>
              <div id="warm-call-property-map" style="height:400px;width:100%"></div>
            </div>`;
          })()}
        </div>

      </div>

      ${(()=>{
        const mapAppts=upcoming.filter(m=>{
          const d=state.deals.find(dd=>dd.id===m.dealId);
          const a=(state.appointments||[]).find(aa=>aa.leadName===m.name&&aa.apptDate===m.date);
          const addr=d?str(d.address||d.location||'').trim():(a?str(a.address||'').trim():'');
          return !!addr;
        });
        const currentAddr=str(deal.address||deal.location||'').trim();
        if(!mapAppts.length && !currentAddr) return '';
        return `<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-top:20px">
          <div style="background:#1e293b;padding:10px 16px;color:#fff;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:13px;font-weight:700">Appointment Locations</div>
            ${info.timeZone?'<div style="font-size:11px;font-weight:600;background:rgba(255,255,255,.15);padding:2px 8px;border-radius:10px">'+esc(info.timeZone)+'</div>':''}
          </div>
          <div id="warm-call-map" style="height:350px;width:100%"></div>
        </div>`;
      })()}

    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend',h);

  // Initialize appointment map
  const mapEl=document.getElementById('warm-call-map');
  if(mapEl && typeof L!=='undefined'){
    const map=L.map(mapEl,{scrollWheelZoom:true}).setView([39.8,-98.5],4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; OpenStreetMap',maxZoom:18
    }).addTo(map);
    const pins=[];
    const currentAddr=str(deal.address||deal.location||'').trim();
    if(currentAddr){
      pins.push({name:deal.company||deal.contact||'This Lead',time:'Current Lead',addr:currentAddr,isCurrent:true});
    }
    upcoming.forEach(m=>{
      const d=state.deals.find(dd=>dd.id===m.dealId);
      const a=(state.appointments||[]).find(aa=>aa.leadName===m.name&&aa.apptDate===m.date);
      const addr=d?str(d.address||d.location||'').trim():(a?str(a.address||'').trim():'');
      if(!addr) return;
      const timeDisp=m.time?m.parsed.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'TBD';
      const dateDisp=m.parsed.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      pins.push({name:m.name,time:dateDisp+' @ '+timeDisp,addr:addr,isCurrent:false});
    });
    const bounds=[];
    let pending=pins.length;
    if(!pending){ map.setView([39.8,-98.5],4); }
    pins.forEach(p=>{
      fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(p.addr))
        .then(r=>r.json()).then(data=>{
          if(data&&data[0]){
            const lat=parseFloat(data[0].lat),lng=parseFloat(data[0].lon);
            const marker=L.marker([lat,lng]).addTo(map);
            const color=p.isCurrent?'#3b82f6':'#059669';
            marker.bindPopup('<div style="font-size:13px;font-weight:700;color:'+color+'">'+p.name+'</div><div style="font-size:11px;color:#475569;margin-top:2px">'+p.time+'</div><div style="font-size:11px;color:#6b7280;margin-top:2px">'+p.addr+'</div>',{maxWidth:250});
            bounds.push([lat,lng]);
          }
        }).catch(()=>{}).finally(()=>{
          pending--;
          if(pending<=0 && bounds.length){
            if(bounds.length===1) map.setView(bounds[0],13);
            else map.fitBounds(bounds,{padding:[30,30]});
          }
        });
    });
  }

  // Initialize property satellite view
  const propMapEl=document.getElementById('warm-call-property-map');
  const propAddr=str(deal.address||deal.location||'').trim();
  if(propMapEl && typeof L!=='undefined' && propAddr){
    const propMap=L.map(propMapEl,{scrollWheelZoom:true}).setView([39.8,-98.5],17);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
      attribution:'Esri, Maxar, Earthstar Geographics',maxZoom:20
    }).addTo(propMap);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{
      maxZoom:20,opacity:0.7
    }).addTo(propMap);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{
      maxZoom:20,opacity:0.8
    }).addTo(propMap);
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q='+encodeURIComponent(propAddr))
      .then(r=>r.json()).then(data=>{
        if(data&&data[0]){
          const lat=parseFloat(data[0].lat),lng=parseFloat(data[0].lon);
          propMap.setView([lat,lng],18);
          const propIcon=L.divIcon({
            className:'',
            html:'<div style="background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap">'+(deal.company||'Property')+'</div>',
            iconAnchor:[40,20]
          });
          L.marker([lat,lng],{icon:propIcon}).addTo(propMap)
            .bindPopup('<div style="font-size:13px;font-weight:700;color:#1e293b">'+(deal.company||deal.contact||'Property')+'</div><div style="font-size:12px;color:#475569;margin-top:4px">'+propAddr+'</div>',{maxWidth:280});
          const radius=150;
          const overpassQuery='[out:json][timeout:10];('
            +'way["building"](around:'+radius+','+lat+','+lng+');'
            +'relation["building"](around:'+radius+','+lat+','+lng+');'
            +'way["landuse"](around:'+radius+','+lat+','+lng+');'
            +'way["leisure"="park"](around:'+radius+','+lat+','+lng+');'
            +'way["leisure"="garden"](around:'+radius+','+lat+','+lng+');'
            +'way["natural"](around:'+radius+','+lat+','+lng+');'
            +');out body;>;out skel qt;';
          fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(overpassQuery))
            .then(r=>r.json()).then(osm=>{
              if(!osm||!osm.elements||!osm.elements.length){
                L.circle([lat,lng],{radius:30,color:'#ef4444',weight:2,fillColor:'#ef4444',fillOpacity:0.15,dashArray:'6 4'}).addTo(propMap);
                return;
              }
              const nodes={};
              osm.elements.filter(e=>e.type==='node').forEach(n=>{nodes[n.id]={lat:n.lat,lon:n.lon};});
              let closestDist=Infinity, closestWay=null;
              const ways=osm.elements.filter(e=>e.type==='way'&&e.nodes&&e.nodes.length>2);
              ways.forEach(w=>{
                const pts=w.nodes.map(nid=>nodes[nid]).filter(Boolean);
                if(!pts.length) return;
                const cx=pts.reduce((s,p)=>s+p.lat,0)/pts.length;
                const cy=pts.reduce((s,p)=>s+p.lon,0)/pts.length;
                const dist=Math.sqrt(Math.pow(cx-lat,2)+Math.pow(cy-lng,2));
                if(dist<closestDist){closestDist=dist;closestWay=w;}
              });
              ways.forEach(w=>{
                const isBuilding=w.tags&&w.tags.building;
                const pts=w.nodes.map(nid=>nodes[nid]).filter(Boolean);
                if(pts.length<3) return;
                const latlngs=pts.map(p=>[p.lat,p.lon]);
                const isClosest=w===closestWay;
                L.polygon(latlngs,{
                  color:isClosest?'#ef4444':(isBuilding?'#fbbf24':'#60a5fa'),
                  weight:isClosest?3:1.5,
                  fillColor:isClosest?'#ef4444':(isBuilding?'#fbbf24':'#60a5fa'),
                  fillOpacity:isClosest?0.25:0.1
                }).addTo(propMap);
              });
              const buildingCount=ways.filter(w=>w.tags&&w.tags.building).length;
              const landUseWays=ways.filter(w=>w.tags&&(w.tags.landuse||w.tags.leisure||w.tags.natural));
              if(buildingCount||landUseWays.length){
                const infoDiv=document.createElement('div');
                infoDiv.style.cssText='padding:6px 10px;background:#1e293b;color:#fff;font-size:11px;border-top:1px solid #334155;display:flex;gap:12px';
                infoDiv.innerHTML='<span><span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:2px;margin-right:4px"></span>Closest match</span>'
                  +(buildingCount?'<span><span style="display:inline-block;width:8px;height:8px;background:#fbbf24;border-radius:2px;margin-right:4px"></span>Buildings ('+buildingCount+')</span>':'')
                  +(landUseWays.length?'<span><span style="display:inline-block;width:8px;height:8px;background:#60a5fa;border-radius:2px;margin-right:4px"></span>Land boundaries ('+landUseWays.length+')</span>':'');
                propMapEl.parentElement.appendChild(infoDiv);
              }
            }).catch(()=>{
              L.circle([lat,lng],{radius:30,color:'#ef4444',weight:2,fillColor:'#ef4444',fillOpacity:0.15,dashArray:'6 4'}).addTo(propMap);
            });
        }
      }).catch(()=>{});
  }

  // Initialize Calendly inline widget
  const calInlineEl=document.getElementById('wc-calendly-inline');
  if(calInlineEl && typeof Calendly!=='undefined'){
    const _baseUrl=calInlineEl.dataset.baseUrl;
    const _clientName=calInlineEl.dataset.client;
    const _dealId=calInlineEl.dataset.dealId;
    initWcCalendlyInline(_baseUrl, _clientName, _dealId);
  }
  }catch(err){console.error('openWarmCallSheet error:',err);}
}

// Helper to get clientIanaTz synchronously from calendly module
function require_calendly_sync(){
  // clientIanaTz is exposed on window by calendly.js
  return { clientIanaTz: window.clientIanaTz || function(){ return null; } };
}

// Calendly inline widget helpers for warm call sheet
let _wcCalRefreshTimer=null;
export function initWcCalendlyInline(baseUrl, clientName, dealId){
  const container=document.getElementById('wc-calendly-inline');
  if(!container||typeof Calendly==='undefined') return;
  import('./calendly.js').then(mod=>mod.setCalendlyBookingDealId(dealId));
  const nameEl=document.getElementById('wc-cal-prefill-name');
  const emailEl=document.getElementById('wc-cal-prefill-email');
  const notesEl=document.getElementById('wc-cal-prefill-notes');
  const name=nameEl?nameEl.value:'';
  const email=emailEl?emailEl.value:'';
  const notes=notesEl?notesEl.value:'';
  const url=new URL(baseUrl.includes('://')?baseUrl:'https://'+baseUrl);
  url.searchParams.set('hide_event_type_details','1');
  url.searchParams.set('hide_gdpr_banner','1');
  if(name) url.searchParams.set('name',name);
  if(email) url.searchParams.set('email',email);
  if(notes) url.searchParams.set('a1',notes);
  const { clientIanaTz: cIanaTz } = require_calendly_sync();
  const ianaTz=cIanaTz(clientName);
  if(ianaTz) url.searchParams.set('timezone',ianaTz);
  container.innerHTML='';
  Calendly.initInlineWidget({url:url.toString(),parentElement:container,prefill:{},utm:{}});
  const observer=new MutationObserver(()=>{
    const iframe=container.querySelector('iframe');
    if(iframe){iframe.style.height='500px';observer.disconnect();}
  });
  observer.observe(container,{childList:true,subtree:true});
}

export function refreshWcCalendlyInline(){
  clearTimeout(_wcCalRefreshTimer);
  _wcCalRefreshTimer=setTimeout(()=>{
    const container=document.getElementById('wc-calendly-inline');
    if(!container) return;
    initWcCalendlyInline(container.dataset.baseUrl,container.dataset.client,container.dataset.dealId);
  },1200);
}

// ─── Push to Lead Tracker ───
export async function pushToLeadTracker(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  if(deal.pushedToTracker && str(deal.pushedToTracker).trim()!==''){
    if(!confirm('Already pushed to tracker. Push again?')) return;
  }
  const btn=document.getElementById('push-tracker-btn');
  if(btn){btn.disabled=true;btn.innerHTML='Pushing...';}
  const { autoPushToTracker } = await import('./email.js');
  try {
    await autoPushToTracker(deal);
    refreshModal(true);
  } catch(e){
    alert('Push to tracker failed: '+e.message);
    if(btn){btn.disabled=false;btn.innerHTML='Retry Push';}
  }
}

// ─── Derive Timezone from location ───
export function deriveTimezone(location){
  if(!location) return '';
  const loc=location.toLowerCase();
  // Eastern
  if(/\b(ny|new york|nj|new jersey|ct|connecticut|ma|massachusetts|pa|pennsylvania|md|maryland|va|virginia|dc|washington|nc|north carolina|sc|south carolina|ga|georgia|fl|florida|oh|ohio|mi|michigan|in|indiana|wv|west virginia|de|delaware|ri|rhode island|vt|vermont|nh|new hampshire|me|maine|ky|kentucky|tn|tennessee|al|alabama)\b/.test(loc)) return 'EST';
  // Central
  if(/\b(tx|texas|il|illinois|wi|wisconsin|mn|minnesota|ia|iowa|mo|missouri|ar|arkansas|la|louisiana|ms|mississippi|ok|oklahoma|ks|kansas|ne|nebraska|sd|south dakota|nd|north dakota)\b/.test(loc)) return 'CST';
  // Mountain
  if(/\b(co|colorado|az|arizona|ut|utah|nm|new mexico|mt|montana|wy|wyoming|id|idaho)\b/.test(loc)) return 'MST';
  // Pacific
  if(/\b(ca|california|or|oregon|wa|washington|nv|nevada)\b/.test(loc)) return 'PST';
  return '';
}

// ─── Push to Client Info sheet ───
export async function pushToClientInfo(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const { CLIENT_INFO_SHEET_ID } = await import('./config.js');
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  const clientName=client?client.name:deal.stage;
  const tz=deriveTimezone(deal.location||deal.address||'');

  pendingWrites.value++;
  try {
    await invokeEdgeFunction('push-lead-tracker',{
      sheetId:CLIENT_INFO_SHEET_ID,
      sheetName:'Info for CRM',
      row:[deal.company||'',deal.contact||'',deal.email||'',deal.phone||'',deal.website||'',deal.location||'',tz,clientName]
    });
  } finally { pendingWrites.value--; }
}

// ─── Copy Lead Info ───
export function copyLeadInfo(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  // If no date/time set, show scheduling prompt first
  const hasBooking=deal.bookedDate && /^\d{4}-\d{2}-\d{2}$/.test(deal.bookedDate) && deal.bookedTime;
  if(!hasBooking){
    showSchedulePrompt(dealId, function(){ doCopyLeadInfo(dealId); });
    return;
  }
  doCopyLeadInfo(dealId);
}

function showSchedulePrompt(dealId, onDone){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const clientName=deal.stage||'';
  const todayStr=getToday();
  const clientAppts=state.deals.filter(d=>{
    if(d.id===dealId) return false;
    if(!isValidDate(d.bookedDate)) return false;
    if(d.bookedDate<todayStr) return false;
    return d.stage===clientName;
  }).sort((a,b)=>{
    return (a.bookedDate+(a.bookedTime||'00:00')).localeCompare(b.bookedDate+(b.bookedTime||'00:00'));
  });
  let apptsHtml='';
  if(clientAppts.length){
    apptsHtml=`<div style="margin:10px 0;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px">
      <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px">${esc(clientName)}'s Existing Appointments (${clientAppts.length})</div>
      ${clientAppts.map(d=>{
        const dt=new Date(d.bookedDate+'T'+(d.bookedTime||'00:00'));
        const dateStr=dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
        const timeStr=d.bookedTime?dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
        return `<div style="font-size:12px;color:#78350f;padding:2px 0;display:flex;justify-content:space-between">
          <span>${esc(d.company||d.contact||'Unknown')}</span>
          <span style="font-weight:600">${dateStr}${timeStr?' @ '+timeStr:''}</span>
        </div>`;
      }).join('')}
    </div>`;
  }
  const overlay=document.createElement('div');
  overlay.id='schedule-prompt-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="background:var(--card,#fff);border-radius:12px;padding:20px;width:360px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">
    <div style="font-size:15px;font-weight:700;color:var(--text,#111);margin-bottom:4px">Schedule This Appointment</div>
    <div style="font-size:12px;color:var(--text-muted,#6b7280);margin-bottom:12px">Set the date & time for <strong>${esc(deal.company||deal.contact||'this lead')}</strong></div>
    ${apptsHtml}
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div style="flex:1">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280);display:block;margin-bottom:3px">Date</label>
        <input type="date" id="sched-date" value="${deal.bookedDate||todayStr}" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div style="flex:1">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280);display:block;margin-bottom:3px">Time</label>
        <input type="time" id="sched-time" value="${deal.bookedTime||'09:00'}" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
    </div>
    <div id="sched-conflict-warning" style="display:none;margin-bottom:10px;padding:6px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:11px;color:#dc2626;font-weight:600"></div>
    <div style="display:flex;gap:8px">
      <button onclick="confirmScheduleAndCopy()" style="flex:1;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Save & Copy Info</button>
      <button onclick="skipScheduleAndCopy()" style="flex:1;padding:10px;background:var(--bg-secondary,#f3f4f6);color:var(--text,#374151);border:1px solid var(--border,#d1d5db);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Skip & Copy</button>
    </div>
    <button onclick="document.getElementById('schedule-prompt-overlay').remove()" style="position:absolute;top:10px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted,#9ca3af)">x</button>
  </div>`;
  overlay.onmousedown=function(e){ overlay._clickStartedOnBackdrop=(e.target===overlay); };
  overlay.onclick=function(e){ if(e.target===overlay && overlay._clickStartedOnBackdrop) overlay.remove(); };
  document.body.appendChild(overlay);
  const dateInput=document.getElementById('sched-date');
  const timeInput=document.getElementById('sched-time');
  const checkConflict=()=>{
    const d=dateInput.value;
    const warn=document.getElementById('sched-conflict-warning');
    if(!warn) return;
    const sameDay=clientAppts.filter(a=>a.bookedDate===d);
    if(sameDay.length){
      const names=sameDay.map(a=>{
        const tm=a.bookedTime?new Date('2000-01-01T'+a.bookedTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
        return esc(a.company||a.contact||'Unknown')+(tm?' @ '+tm:'');
      }).join(', ');
      warn.style.display='block';
      warn.innerHTML='\u26A0 '+esc(clientName)+' already has '+sameDay.length+' appointment'+(sameDay.length>1?'s':'')+' on this day: '+names;
    } else { warn.style.display='none'; }
  };
  dateInput.addEventListener('change',checkConflict);
  timeInput.addEventListener('change',checkConflict);
  checkConflict();
  window._schedDealId=dealId;
  window._schedOnDone=onDone;
}

export async function doCopyLeadInfo(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const { buildLeadMessage } = await import('./email.js');
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  const msg=buildLeadMessage(deal, client?client.name:'');
  if(msg){
    navigator.clipboard.writeText(msg).then(()=>{
      const btn=document.querySelector('[onclick*="copyLeadInfo"]');
      if(btn){ const orig=btn.innerHTML; btn.innerHTML='<span style="color:#059669">Copied!</span>'; setTimeout(()=>btn.innerHTML=orig, 1500); }
    }).catch(()=>{
      prompt('Copy this text:',msg);
    });
  }
}

// Expose to inline HTML handlers
window.openWarmCallSheet = openWarmCallSheet;
window.pushToLeadTracker = pushToLeadTracker;
window.pushToClientInfo = pushToClientInfo;
window.copyLeadInfo = copyLeadInfo;
window.doCopyLeadInfo = doCopyLeadInfo;
window.deriveTimezone = deriveTimezone;
window.initWcCalendlyInline = initWcCalendlyInline;
window.refreshWcCalendlyInline = refreshWcCalendlyInline;
