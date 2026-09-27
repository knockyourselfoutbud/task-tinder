// Small server-rendered pages: login, setup (connections), PWA bits.

const BASE_CSS = `
:root{--bg:#f6f5f1;--surface:#fff;--surface-2:#f0efe9;--border:rgba(0,0,0,.08);--text:#3d3a34;--dim:#8a8578;--bright:#1a1815;--green:#16a163;--red:#dc4a4a;--accent:#7c5cfc;--mono:'DM Mono',ui-monospace,monospace;--sans:'Outfit',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--surface:#201f1c;--surface-2:#2a2925;--border:rgba(255,255,255,.08);--text:#d9d5cc;--dim:#8f8a7f;--bright:#f3f0e8;--green:#3cc486;--red:#f06a6a;--accent:#9d86ff}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sans);background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
.wrap{max-width:420px;margin:0 auto;padding:48px 20px}
h1{font-size:22px;font-weight:600;color:var(--bright);letter-spacing:-.02em;margin-bottom:6px}
.sub{font-family:var(--mono);font-size:11px;color:var(--dim);margin-bottom:28px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:12px}
input{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:16px;font-family:var(--sans)}
button,.btn{display:inline-block;padding:11px 16px;border:none;border-radius:10px;background:var(--bright);color:var(--bg);font-family:var(--mono);font-size:12px;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--dim);border:1px solid var(--border)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.name{font-weight:500;color:var(--bright)}
.status{font-family:var(--mono);font-size:11px;margin-top:3px}
.ok{color:var(--green)}.bad{color:var(--red)}
.err{color:var(--red);font-family:var(--mono);font-size:12px;margin-top:10px}
a{color:var(--accent)}
.foot{font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:22px;line-height:1.7}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">`;

function shell(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="theme-color" content="#1a1815"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg">
${FONTS}<style>${BASE_CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loginPage({ error, next, missing }) {
  return shell('Task Tinder · Sign in', `
<h1>Task Tinder</h1><div class="sub">enter your passcode</div>
${missing ? `<div class="card err">APP_PASSCODE isn't set. Run <code>npx wrangler secret put APP_PASSCODE</code> (or add it to .dev.vars locally).</div>` : ''}
<form method="POST" action="/login" class="card">
  <input type="hidden" name="next" value="${esc(next || '/')}">
  <input type="password" name="passcode" placeholder="Passcode" autocomplete="current-password" autofocus>
  <div style="margin-top:12px"><button type="submit">sign in</button></div>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
</form>`);
}

export function setupPage({ ticktick, gmail, mock, notice, missing }) {
  const row = (name, key, st, hint) => `
<div class="card"><div class="row">
  <div><div class="name">${name}</div>
  <div class="status ${st.connected ? 'ok' : 'bad'}">${st.connected ? 'connected' : 'not connected'}${st.note ? ' · ' + esc(st.note) : ''}</div></div>
  <div>${mock ? '<span class="status">mock mode</span>' : st.configured
    ? `<a class="btn" href="/oauth/${key}/start">${st.connected ? 'reconnect' : 'connect'}</a>`
    : `<span class="status bad">set secrets first</span>`}</div>
</div>${hint && !st.configured && !mock ? `<div class="status" style="margin-top:10px">${hint}</div>` : ''}
${st.connected && !mock ? `<form method="POST" action="/oauth/${key}/disconnect" style="margin-top:10px"><button class="btn ghost" type="submit">disconnect</button></form>` : ''}
</div>`;
  return shell('Task Tinder · Setup', `
<h1>Connections</h1><div class="sub">where your cards come from</div>
${notice ? `<div class="card status ${notice.ok ? 'ok' : 'bad'}">${esc(notice.text)}</div>` : ''}
${missing.length ? `<div class="card status bad">Missing: ${missing.map(esc).join(', ')}</div>` : ''}
${row('TickTick', 'ticktick', ticktick, 'Needs TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET.')}
${row('Gmail (starred)', 'google', gmail, 'Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')}
<div class="row" style="margin-top:18px"><a class="btn" href="/">back to deck</a>
<form method="POST" action="/logout"><button class="btn ghost" type="submit">sign out</button></form></div>
<div class="foot">Redirect URIs to register:<br>${esc(ticktick.redirect)}<br>${esc(gmail.redirect)}</div>`);
}

export const MANIFEST = JSON.stringify({
  name: 'Task Tinder',
  short_name: 'Tinder Tasks',
  start_url: '/',
  display: 'standalone',
  background_color: '#f6f5f1',
  theme_color: '#1a1815',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
});

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1a1815"/><rect x="136" y="150" width="240" height="250" rx="34" fill="#f6f5f1" transform="rotate(-8 256 275)"/><rect x="136" y="130" width="240" height="250" rx="34" fill="#fff" stroke="#16a163" stroke-width="10" transform="rotate(6 256 255)"/><path d="M205 260l38 38 76-86" fill="none" stroke="#16a163" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" transform="rotate(6 256 255)"/></svg>`;
