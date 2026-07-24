// Push a CRM activity to the logged-in user's Google Tasks as an all-day task.
import { state } from './app.js?v=20260724120456';
import { invokeEdgeFunction, showToast } from './api.js?v=20260724120456';
import { currentUser } from './auth.js?v=20260724120456';
import { str } from './utils.js?v=20260724120456';

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
    await invokeEdgeFunction('create-google-task', { userEmail: currentUser.email, title, due, notes });
    showToast('Added to Google Tasks', 'success');
  } catch (e) {
    showToast('Google Tasks failed: ' + e.message, 'error');
  }
}

window.pushActivityToGoogleTask = pushActivityToGoogleTask;
