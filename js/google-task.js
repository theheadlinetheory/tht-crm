// Push a CRM activity to the logged-in user's Google Tasks as an all-day task.
import { state } from './app.js?v=20260905075300';
import { showToast } from './api.js?v=20260905075300';
import { currentUser } from './auth.js?v=20260905075300';
import { supabase } from './supabase-client.js?v=20260905075300';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260905075300';
import { str } from './utils.js?v=20260905075300';

// Sends the signed-in user's session token rather than the shared anon key: the
// edge function reads whose task list to write to off that token, so the anon
// key alone can no longer aim a task at someone else's account. Same approach as
// smartlead-portal.js.
async function createTask(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired — reload and sign in again');
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-google-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({ error: `create-google-task returned ${resp.status}` }));
  if (!resp.ok || data.error) throw new Error(data.error || `create-google-task failed (${resp.status})`);
  return data;
}

export function buildTaskFields(activity, deal) {
  const company = str(deal.company) || str(deal.contact) || 'Deal';
  const subject = str(activity.subject).trim();
  const title = subject ? `${company} — ${subject}` : `${str(activity.type) || 'Follow-up'}: ${company}`;
  const due = str(activity.dueDate).slice(0, 10);
  const noteLines = [];
  if (deal.contact) noteLines.push(`Contact: ${str(deal.contact)}`);
  if (deal.email) noteLines.push(`Email: ${str(deal.email)}`);
  if (deal.phone) noteLines.push(`Phone: ${str(deal.phone)}`);
  if (deal.location) noteLines.push(`Location: ${str(deal.location)}`);
  return { title, due, notes: noteLines.join('\n') };
}

export async function pushActivityToGoogleTask(activityId) {
  const activity = state.activities.find(a => String(a.id) === String(activityId));
  if (!activity) return;
  const deal = state.deals.find(d => String(d.id) === String(activity.dealId));
  if (!deal) { showToast('Deal not found', 'error'); return; }
  if (!activity.dueDate) { showToast('Add a date to this task first', 'warning'); return; }
  if (!currentUser || !currentUser.email) { showToast('Not signed in', 'error'); return; }

  const { title, due, notes } = buildTaskFields(activity, deal);
  try {
    await createTask({ title, due, notes });
    showToast('Added to Google Tasks', 'success');
  } catch (e) {
    showToast('Google Tasks failed: ' + e.message, 'error');
  }
}

window.pushActivityToGoogleTask = pushActivityToGoogleTask;
