import type { FeedbackRow, Stats } from './store.js';

/** Everything that goes into the page is escaped: feedback text is written by strangers. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

// No scripts at all (the CSP is default-src 'none'); light and dark from the system setting.
const STYLE = `
:root { color-scheme: light dark; --bg: #f7f7f5; --fg: #1d1d1b; --muted: #5d5d58; --card: #ffffff; --line: #deded8; --accent: #0b6e4f; --warn: #9a3412; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ececea; --muted: #a8a8a2; --card: #1f1f1d; --line: #34342f; --accent: #5cc8a1; --warn: #fdba74; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 16px; }
h2 { font-size: 17px; margin: 28px 0 10px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.tile .n { font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tile .l { color: var(--muted); font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.fb { margin: 0 0 12px; }
.fb .meta { color: var(--muted); font-size: 13px; margin-bottom: 6px; overflow-wrap: anywhere; }
.fb .text { white-space: pre-wrap; overflow-wrap: anywhere; }
.notmailed { color: var(--warn); }
form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); min-width: 0; }
button { font: inherit; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
@media (prefers-color-scheme: dark) { button { color: #10201a; } }
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.top form button { background: transparent; color: var(--muted); border: 1px solid var(--line); }
.msg { color: var(--muted); margin: 0 0 12px; }
.empty { color: var(--muted); }
@media (max-width: 560px) { .tiles { grid-template-columns: 1fr; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** Step 1 asks for the address, step 2 for the code. The answer to step 1 is the same for any address. */
export function loginPage(step: 'email' | 'code', message?: string): string {
  const msg = message ? `<p class="msg">${escapeHtml(message)}</p>` : '';
  const form = step === 'email'
    ? `<form method="post" action="/admin/code">
  <input type="email" name="email" autocomplete="email" required placeholder="E-mail" aria-label="E-mail">
  <button type="submit">Send code</button>
</form>`
    : `<form method="post" action="/admin/login">
  <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="6-digit code" aria-label="Code">
  <button type="submit">Sign in</button>
</form>
<p class="msg"><a href="/admin">Ask for a new code</a></p>`;
  return page('BewerbungsPilot admin', `<h1>BewerbungsPilot admin</h1><div class="card">${msg}${form}</div>`);
}

export function dashboardPage(stats: Stats, feedback: FeedbackRow[]): string {
  const tile = (n: number, label: string) => `<div class="card tile"><div class="n">${n}</div><div class="l">${escapeHtml(label)}</div></div>`;
  const versions = stats.versions.length
    ? `<table><thead><tr><th>Version</th><th class="num">Users (30 days)</th></tr></thead><tbody>${
      stats.versions.map((v) => `<tr><td>${escapeHtml(v.version)}</td><td class="num">${v.users}</td></tr>`).join('')
    }</tbody></table>`
    : '<p class="empty">No users in the last 30 days.</p>';
  const list = feedback.length
    ? feedback.map((f) => `<div class="card fb">
  <div class="meta">${escapeHtml(f.createdAt.slice(0, 16).replace('T', ' '))} UTC · ${escapeHtml(f.version)} · ${f.kind === 'problem' ? 'Problem' : 'Idea'} · ${escapeHtml(f.language)} · ${escapeHtml(f.email)}${
    f.mailed ? '' : ' · <span class="notmailed">mail not sent</span>'}</div>
  <div class="text">${escapeHtml(f.text)}</div>
</div>`).join('\n')
    : '<p class="empty">No feedback yet.</p>';
  return page('BewerbungsPilot admin', `<div class="top"><h1>BewerbungsPilot admin</h1>
<form method="post" action="/admin/logout"><button type="submit">Sign out</button></form></div>
<h2>Users</h2>
<div class="tiles">${tile(stats.users.d1, 'Last day')}${tile(stats.users.d7, 'Last 7 days')}${tile(stats.users.d30, 'Last 30 days')}</div>
<h2>Versions</h2>
<div class="card">${versions}</div>
<h2>Feedback (${feedback.length})</h2>
${list}`);
}
