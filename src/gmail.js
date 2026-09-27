// Gmail API client — reads starred mail, unstars on completion.
import { kvGet, kvSet } from './store.js';
import { mockGmail } from './mock.js';
import { NotConnected } from './ticktick.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const TOKEN_KEY = 'google_token';

export function googleAuthUrl(env, redirectUri, state) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (env.GOOGLE_LOGIN_HINT) p.set('login_hint', env.GOOGLE_LOGIN_HINT);
  return `${AUTH_URL}?${p}`;
}

export async function googleExchangeCode(env, code, redirectUri) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  const t = await r.json();
  const prev = (await kvGet(env, TOKEN_KEY)) || {};
  await kvSet(env, TOKEN_KEY, {
    access_token: t.access_token,
    refresh_token: t.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
  });
}

async function token(env) {
  const tok = await kvGet(env, TOKEN_KEY);
  if (!tok?.refresh_token && !tok?.access_token) throw new NotConnected('Gmail not connected');
  if (tok.access_token && tok.expires_at > Date.now() + 60_000) return tok.access_token;
  if (!tok.refresh_token) throw new NotConnected('Gmail token expired — reconnect');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    // invalid_grant = refresh token revoked/expired (e.g. OAuth app still in "Testing")
    throw new NotConnected(`Gmail refresh failed (${r.status}) — reconnect`);
  }
  const t = await r.json();
  await kvSet(env, TOKEN_KEY, {
    access_token: t.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
  });
  return t.access_token;
}

async function call(env, path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(env)}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (r.status === 401) throw new NotConnected('Gmail rejected the token — reconnect');
  if (!r.ok) throw new Error(`Gmail ${init.method || 'GET'} ${path} → ${r.status}`);
  return r.json();
}

function header(msg, name) {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function fromName(from) {
  // "Linda Liu <linda@x.com>" → "Linda Liu"
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from || '');
  return m ? m[1] : (from || '').replace(/<.*>/, '').trim();
}

export function gmailClient(env) {
  if (env.MOCK === '1') return mockGmail;
  const query = env.GMAIL_QUERY || 'is:starred';
  const max = Math.min(parseInt(env.GMAIL_MAX || '15', 10) || 15, 30);
  return {
    async connected() {
      const tok = await kvGet(env, TOKEN_KEY);
      return !!(tok?.refresh_token || tok?.access_token);
    },
    // Returns one entry per thread: { threadId, messageId, subject, from, snippet, date, internalDate, labelIds }
    async starredThreads() {
      const list = await call(env, `/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`);
      const seen = new Set();
      const ids = [];
      for (const m of list.messages || []) {
        if (seen.has(m.threadId)) continue;
        seen.add(m.threadId);
        ids.push(m);
      }
      const msgs = await Promise.all(
        ids.map((m) =>
          call(env, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)
        )
      );
      return msgs.map((msg) => ({
        threadId: msg.threadId,
        messageId: msg.id,
        subject: header(msg, 'Subject'),
        from: fromName(header(msg, 'From')),
        snippet: msg.snippet ? msg.snippet.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '',
        date: msg.internalDate ? Number(msg.internalDate) : null,
        internalDate: msg.internalDate ? Number(msg.internalDate) : 0,
        labelIds: msg.labelIds || [],
      }));
    },
    unstarThread: (threadId) =>
      call(env, `/threads/${threadId}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['STARRED'] }) }),
  };
}
