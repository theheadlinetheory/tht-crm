// ═══════════════════════════════════════════════════════════
// GMAIL-BODY — pure text helpers for the Gmail history rows
// ═══════════════════════════════════════════════════════════
//
// Import-free on purpose: node runs these directly from
// scripts/test-gmail-body.mjs, which can't resolve the ?v= cache tokens the
// browser modules carry. Keep it that way — no imports here.

// Lines that mean "everything below this is a quote or a signature".
// Deliberately conservative: only markers a mail client actually writes. A
// human sign-off ("Best,\nAidan") is NOT a marker — guessing at those eats
// real text, and a missed signature is far cheaper than a swallowed sentence.
const CUT_LINE = [
  /^--\s*$/,                              // RFC 3676 signature delimiter
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,  // Outlook
  /^>/,                                   // quoted line
  /^Sent from my /i,                      // phone footer
];

// Gmail writes "On <date> <person> wrote:" and hard-wraps it, so "wrote:" can
// land one or two lines below the "On". Join forward before deciding.
function isQuoteAttribution(lines, i) {
  if (!/^On\b/.test(lines[i])) return false;
  for (let k = 1; k <= 3; k++) {
    if (/^On\b.*wrote:$/.test(lines.slice(i, i + k).join(' ').trim())) return true;
  }
  return false;
}

// Outlook's forwarded-header block. Needs the Sent:/Date: line under it —
// "From what I can tell…" is a sentence, not a header.
function isForwardHeader(lines, i) {
  if (!/^From:\s/.test(lines[i])) return false;
  return lines.slice(i + 1, i + 4).some(l => /^(Sent|Date):\s/.test(l));
}

/**
 * Strip the quoted chain and signature off a message body for display.
 * Returns the visible text plus how many lines were hidden, so the caller can
 * offer "show full message". The raw body is never modified.
 */
export function trimBody(text) {
  if (typeof text !== 'string' || !text) return { text: '', cutLines: 0 };
  const lines = text.split('\n');

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CUT_LINE.some(re => re.test(lines[i])) || isQuoteAttribution(lines, i) || isForwardHeader(lines, i)) {
      cut = i;
      break;
    }
  }
  if (cut === -1) return { text: text.trim(), cutLines: 0 };

  const kept = lines.slice(0, cut).join('\n').trim();
  // A bare forward is all quote. Showing an empty box would lose the message,
  // so in that case the raw body IS the best view of it.
  if (!kept) return { text: text.trim(), cutLines: 0 };

  return { text: kept, cutLines: lines.length - cut };
}

/** Gmail-style row date: time today, "Sep 8" this year, "9/8/25" before that. */
export function formatThreadDate(ts, now) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  const ref = now || new Date();
  if (d.toDateString() === ref.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (d.getFullYear() === ref.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
