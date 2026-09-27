// TickTick Open API client (https://developer.ticktick.com)
import { kvGet, kvSet } from './store.js';
import { mockTickTick } from './mock.js';

const AUTH_URL = 'https://ticktick.com/oauth/authorize';
const TOKEN_URL = 'https://ticktick.com/oauth/token';
const API = 'https://api.ticktick.com/open/v1';
const SCOPE = 'tasks:read tasks:write';
const TOKEN_KEY = 'ticktick_token';

export class NotConnected extends Error {}

export function ticktickAuthUrl(env, redirectUri, state) {
  const p = new URLSearchParams({
    client_id: env.TICKTICK_CLIENT_ID,
    scope: SCOPE,
    state,
    redirect_uri: redirectUri,
    response_type: 'code',
  });
  return `${AUTH_URL}?${p}`;
}

export async function ticktickExchangeCode(env, code, redirectUri) {
  const body = new URLSearchParams({
    client_id: env.TICKTICK_CLIENT_ID,
    client_secret: env.TICKTICK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    scope: SCOPE,
    redirect_uri: redirectUri,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${env.TICKTICK_CLIENT_ID}:${env.TICKTICK_CLIENT_SECRET}`),
    },
    body,
  });
  if (!r.ok) throw new Error(`TickTick token exchange failed: ${r.status} ${await r.text()}`);
  const t = await r.json();
  await kvSet(env, TOKEN_KEY, {
    access_token: t.access_token,
    refresh_token: t.refresh_token || null,
    expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null,
  });
}

async function refreshIfPossible(env, tok) {
  if (!tok.refresh_token) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${env.TICKTICK_CLIENT_ID}:${env.TICKTICK_CLIENT_SECRET}`),
    },
    body,
  });
  if (!r.ok) return null;
  const t = await r.json();
  const next = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || tok.refresh_token,
    expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null,
  };
  await kvSet(env, TOKEN_KEY, next);
  return next;
}

async function token(env) {
  let tok = await kvGet(env, TOKEN_KEY);
  if (!tok?.access_token) throw new NotConnected('TickTick not connected');
  if (tok.expires_at && tok.expires_at < Date.now() + 60_000) {
    tok = (await refreshIfPossible(env, tok)) || tok;
    if (tok.expires_at && tok.expires_at < Date.now()) throw new NotConnected('TickTick token expired — reconnect');
  }
  return tok.access_token;
}

async function call(env, path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token(env)}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (r.status === 401) throw new NotConnected('TickTick rejected the token — reconnect');
  if (!r.ok) throw new Error(`TickTick ${init.method || 'GET'} ${path} → ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export function ticktickClient(env) {
  if (env.MOCK === '1') return mockTickTick;
  return {
    async connected() {
      const tok = await kvGet(env, TOKEN_KEY);
      return !!tok?.access_token;
    },
    listProjects: () => call(env, '/project'),
    projectData: (projectId) => call(env, `/project/${encodeURIComponent(projectId)}/data`),
    getTask: (projectId, taskId) =>
      call(env, `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`),
    complete: (projectId, taskId) =>
      call(env, `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`, { method: 'POST' }),
    // Always send the full task object back so nothing gets wiped
    update: (task) => call(env, `/task/${encodeURIComponent(task.id)}`, { method: 'POST', body: JSON.stringify(task) }),
    create: (task) => call(env, '/task', { method: 'POST', body: JSON.stringify(task) }),
    move: (fromProjectId, toProjectId, taskId) =>
      call(env, '/task/move', { method: 'POST', body: JSON.stringify([{ fromProjectId, toProjectId, taskId }]) }),
  };
}
