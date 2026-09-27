// Task Tinder — Cloudflare Worker backend (TickTick + starred Gmail edition)
import INDEX_HTML from './index.html';
import {
  isAuthed, checkPasscode, sessionCookie, clearSessionCookie, getCookie, cookieHeader, randomState,
} from './auth.js';
import { loginPage, setupPage, MANIFEST, ICON_SVG } from './pages.js';
import { ticktickClient, ticktickAuthUrl, ticktickExchangeCode, NotConnected } from './ticktick.js';
import { gmailClient, googleAuthUrl, googleExchangeCode } from './gmail.js';
import { kvDelete } from './store.js';
import {
  cardFromTickTick, cardFromEmail, sortDeck, localDay, stripEmoji, EFFORTS, ENERGIES, PRIORITY_OF_LANE,
} from './triage.js';

const DEFAULT_EXCLUDES = 'Work,Someday,Backlog,Shopping';

// ── helpers ──

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...headers } });

function cfg(env) {
  const tz = env.TZ || 'America/New_York';
  return { tz, today: localDay(new Date(), tz) };
}

function isSecure(url) {
  return url.protocol === 'https:';
}

function parseKey(key) {
  const [src, a, b] = String(key || '').split(':');
  if (src === 'tt' && a && b) return { source: 'ticktick', projectId: a, taskId: b };
  if (src === 'gm' && a) return { source: 'email', threadId: a };
  return null;
}

async function body(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function missingSecrets(env) {
  if (env.MOCK === '1') return [];
  return ['APP_PASSCODE', 'TICKTICK_CLIENT_ID', 'TICKTICK_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    .filter((k) => !env[k]);
}

// ── deck ──

async function buildDeck(env) {
  const c = cfg(env);
  const tt = ticktickClient(env);
  const gm = gmailClient(env);
  const sources = { ticktick: { status: 'ok' }, gmail: { status: 'ok' } };

  // Your triage state from D1
  const [metaRows, hiddenRows] = await Promise.all([
    env.DB.prepare('SELECT task_key, effort, energy FROM task_meta').all(),
    env.DB.prepare(
      `SELECT DISTINCT task_key FROM dismissals
       WHERE (reason = 'skip' AND day = ?) OR (reason = 'delegate' AND day >= date(?, '-7 days'))`
    ).bind(c.today, c.today).all(),
  ]);
  const meta = Object.fromEntries((metaRows.results || []).map((r) => [r.task_key, r]));
  const hidden = new Set((hiddenRows.results || []).map((r) => r.task_key));

  // TickTick
  const cards = [];
  let ttText = '';
  try {
    const excludes = (env.TICKTICK_EXCLUDE_PROJECTS ?? DEFAULT_EXCLUDES)
      .split(',').map((s) => stripEmoji(s).toLowerCase()).filter(Boolean);
    const projects = (await tt.listProjects()).filter(
      (p) => p.kind !== 'NOTE' && !p.closed && !excludes.includes(stripEmoji(p.name).toLowerCase())
    );
    const inboxId = env.TICKTICK_INBOX_ID || 'inbox';
    if (!projects.some((p) => p.id === inboxId)) projects.push({ id: inboxId, name: 'Inbox' });

    const results = await Promise.allSettled(projects.map((p) => tt.projectData(p.id)));
    const failed = [];
    results.forEach((r, i) => {
      const project = projects[i];
      if (r.status !== 'fulfilled') { failed.push(stripEmoji(project.name)); return; }
      const data = r.value || {};
      const columnsById = Object.fromEntries((data.columns || []).map((col) => [col.id, col.name]));
      for (const task of data.tasks || []) {
        if (task.parentId || (task.status && task.status !== 0)) continue;
        ttText += ' ' + (task.title || '') + ' ' + (task.content || '');
        const tl = (task.tags || []).map((t) => String(t).toLowerCase());
        if (tl.includes('claude')) continue; // delegated to Claude
        const card = cardFromTickTick({ ...task, projectId: task.projectId || project.id }, project, columnsById, meta[`tt:${task.projectId || project.id}:${task.id}`], c);
        if (!hidden.has(card.id)) cards.push(card);
      }
    });
    if (failed.length) sources.ticktick = { status: 'partial', note: `couldn't load: ${failed.join(', ')}` };
  } catch (e) {
    sources.ticktick = { status: e instanceof NotConnected ? 'not_connected' : 'error', note: e.message };
  }

  // Starred Gmail
  try {
    const threads = await gm.starredThreads();
    for (const th of threads) {
      // Skip emails you've already turned into TickTick tasks (link contains the id)
      if (ttText.includes(th.threadId) || (th.messageId && ttText.includes(th.messageId))) continue;
      const card = cardFromEmail(th, meta[`gm:${th.threadId}`], c);
      if (!hidden.has(card.id)) cards.push(card);
    }
  } catch (e) {
    sources.gmail = { status: e instanceof NotConnected ? 'not_connected' : 'error', note: e.message };
  }

  return {
    tasks: sortDeck(cards),
    sources,
    today: c.today,
    sprintSize: parseInt(env.SPRINT_SIZE || '3', 10) || 3,
    highLimit: parseInt(env.HIGH_LIMIT || '5', 10) || 5,
  };
}

// ── API handlers ──

async function apiComplete(env, data) {
  const k = parseKey(data.task_id);
  if (!k) throw new HttpError(400, 'task_id required');
  if (k.source === 'ticktick') await ticktickClient(env).complete(k.projectId, k.taskId);
  else await gmailClient(env).unstarThread(k.threadId);
  const t = data.task || {};
  await env.DB.prepare(
    `INSERT INTO completions (task_key, task_title, source, project, lane, effort, energy, method_notes, time_taken_sec, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.task_id, t.title || '', k.source, t.project || '', t.lane || '', t.effort || '', t.energy || '',
    data.method_notes || '', Math.max(0, parseInt(data.time_taken_sec || 0, 10) || 0), data.session_id || null
  ).run();
  return { ok: true };
}

async function apiDismiss(env, data) {
  const k = parseKey(data.task_id);
  const reason = ['skip', 'delegate', 'started'].includes(data.reason) ? data.reason : 'skip';
  if (!k) throw new HttpError(400, 'task_id required');
  const t = data.task || {};
  const note = (data.note || '').slice(0, 2000);

  if (reason === 'delegate') {
    const tt = ticktickClient(env);
    if (k.source === 'ticktick') {
      const full = await tt.getTask(k.projectId, k.taskId);
      const tags = new Set((full.tags || []).map(String));
      tags.add('claude');
      full.tags = [...tags];
      if (note) full.content = `${full.content ? full.content + '\n\n' : ''}🤖 For Claude: ${note}`;
      await tt.update(full);
    } else {
      await tt.create({
        projectId: env.TICKTICK_INBOX_ID || 'inbox',
        title: `[${t.title || 'Starred email'}](https://mail.google.com/mail/u/0/#all/${k.threadId})`,
        content: `Delegated from Task Tinder.${note ? '\n\n🤖 For Claude: ' + note : ''}`,
        tags: ['claude'],
      });
    }
  }

  await env.DB.prepare('INSERT INTO dismissals (task_key, task_title, reason, note, day) VALUES (?, ?, ?, ?, ?)')
    .bind(data.task_id, t.title || '', reason, note, cfg(env).today).run();
  return { ok: true };
}

// ── Priority ──

function emailTaskTitle(t, threadId) {
  const subject = String(t.title || 'Starred email').replace(/[\[\]]/g, '');
  return `[${subject}](https://mail.google.com/mail/u/0/#all/${threadId})`;
}

// Set TickTick priority. A starred email becomes a TickTick task (linked to
// the email) and is unstarred — TickTick is its home from then on.
async function apiPriority(env, data) {
  const k = parseKey(data.task_id);
  if (!k) throw new HttpError(400, 'task_id required');
  const priority = [0, 1, 3, 5].includes(data.priority) ? data.priority
    : PRIORITY_OF_LANE[data.lane] ?? null;
  if (priority === null) throw new HttpError(400, 'priority must be 0, 1, 3 or 5');
  const tt = ticktickClient(env);
  const c = cfg(env);

  if (k.source === 'ticktick') {
    const full = await tt.getTask(k.projectId, k.taskId);
    const previous = full.priority || 0;
    full.priority = priority;
    await tt.update(full);
    return { ok: true, previous, card: cardFromTickTick(full, { name: data.task?.project || 'Inbox' }, {}, null, c) };
  }

  const t = data.task || {};
  const created = await tt.create({
    projectId: env.TICKTICK_INBOX_ID || 'inbox',
    title: emailTaskTitle(t, k.threadId),
    content: t.context ? `From starred email: ${t.context}` : 'From a starred email.',
    priority,
  });
  await gmailClient(env).unstarThread(k.threadId).catch(() => {});
  const card = cardFromTickTick({ priority, createdTime: null, ...created }, { name: 'Inbox' }, {}, null, c);
  return { ok: true, converted: true, card };
}

async function apiMeta(env, data) {
  if (!parseKey(data.task_id)) throw new HttpError(400, 'task_id required');
  const effort = data.effort === null ? null : EFFORTS.includes(data.effort) ? data.effort : undefined;
  const energy = data.energy === null ? null : ENERGIES.includes(data.energy) ? data.energy : undefined;
  const row = await env.DB.prepare('SELECT effort, energy FROM task_meta WHERE task_key = ?').bind(data.task_id).first();
  const next = { effort: effort !== undefined ? effort : row?.effort ?? null, energy: energy !== undefined ? energy : row?.energy ?? null };
  await env.DB.prepare(
    `INSERT INTO task_meta (task_key, effort, energy, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(task_key) DO UPDATE SET effort = excluded.effort, energy = excluded.energy, updated_at = excluded.updated_at`
  ).bind(data.task_id, next.effort, next.energy).run();
  return { ok: true, ...next };
}

async function apiAddTask(env, data) {
  const title = String(data.title || '').trim();
  if (!title) throw new HttpError(400, 'title required');
  const tags = [];
  if (EFFORTS.includes(data.effort)) tags.push(data.effort);
  if (ENERGIES.includes(data.energy)) tags.push(`energy-${data.energy}`);
  const created = await ticktickClient(env).create({
    projectId: env.TICKTICK_INBOX_ID || 'inbox',
    title,
    content: data.context || '',
    tags,
  });
  return { ok: true, id: created?.id };
}

async function apiSession(env, data) {
  if (data.action === 'start') {
    const r = await env.DB.prepare('INSERT INTO sessions (budget, energy, kind) VALUES (?, ?, ?)')
      .bind(String(data.budget || 'all'), String(data.energy || 'all'), data.kind === 'two_minute' ? 'two_minute' : 'sprint').run();
    return { session_id: r.meta.last_row_id };
  }
  if (data.action === 'end') {
    const s = data.stats || {};
    await env.DB.prepare(
      `UPDATE sessions SET completed_at = datetime('now'), tasks_completed = ?, tasks_skipped = ? WHERE id = ?`
    ).bind(s.completed || 0, s.skipped || 0, data.session_id || 0).run();
    return { ok: true };
  }
  throw new HttpError(400, 'unknown action');
}

async function apiStats(env) {
  const today = cfg(env).today;
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [done, doneToday, delegated, sprints, starts] = await Promise.all([
    q('SELECT COUNT(*) n FROM completions'),
    q(`SELECT COUNT(*) n FROM completions WHERE date(completed_at) = ?`, today),
    q(`SELECT COUNT(*) n FROM dismissals WHERE reason = 'delegate'`),
    q(`SELECT COUNT(*) n FROM sessions WHERE completed_at IS NOT NULL AND kind = 'sprint'`),
    q(`SELECT COUNT(*) n FROM dismissals WHERE reason = 'started'`),
  ]);
  const recent = await env.DB.prepare(
    'SELECT task_title, method_notes, time_taken_sec, completed_at FROM completions ORDER BY id DESC LIMIT 10'
  ).all();
  return {
    completed: done.n, completed_today: doneToday.n, delegated: delegated.n, sessions: sprints.n,
    two_minute_starts: starts.n, recent_completions: recent.results || [],
  };
}

async function apiPatterns(env) {
  const rows = await env.DB.prepare(
    `SELECT task_title, method_notes, time_taken_sec, source, project, lane, effort, energy, completed_at
     FROM completions WHERE method_notes IS NOT NULL AND method_notes != '' ORDER BY id DESC LIMIT 100`
  ).all();
  return { patterns: rows.results || [] };
}

async function apiDelegations(env) {
  const rows = await env.DB.prepare(
    `SELECT task_key, task_title, note, created_at FROM dismissals WHERE reason = 'delegate' ORDER BY id DESC LIMIT 50`
  ).all();
  return { delegations: rows.results || [] };
}

// ── OAuth ──

function redirectUri(url, svc) {
  return `${url.origin}/oauth/${svc}/callback`;
}

async function oauth(request, env, url, svc, step) {
  const secure = isSecure(url);
  if (step === 'start') {
    const state = randomState();
    const to = svc === 'ticktick'
      ? ticktickAuthUrl(env, redirectUri(url, svc), state)
      : googleAuthUrl(env, redirectUri(url, svc), state);
    return redirect(to, { 'Set-Cookie': cookieHeader('tt_oauth', `${svc}.${state}`, 600, secure) });
  }
  if (step === 'callback') {
    const expected = getCookie(request, 'tt_oauth');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const clear = cookieHeader('tt_oauth', '', 0, secure);
    if (url.searchParams.get('error')) return redirect(`/setup?err=${encodeURIComponent(url.searchParams.get('error'))}`, { 'Set-Cookie': clear });
    if (!code || !state || expected !== `${svc}.${state}`) return redirect('/setup?err=state_mismatch', { 'Set-Cookie': clear });
    try {
      if (svc === 'ticktick') await ticktickExchangeCode(env, code, redirectUri(url, svc));
      else await googleExchangeCode(env, code, redirectUri(url, svc));
    } catch (e) {
      return redirect(`/setup?err=${encodeURIComponent(e.message.slice(0, 200))}`, { 'Set-Cookie': clear });
    }
    return redirect(`/setup?ok=${svc}`, { 'Set-Cookie': clear });
  }
  if (step === 'disconnect' && request.method === 'POST') {
    await kvDelete(env, svc === 'ticktick' ? 'ticktick_token' : 'google_token');
    return redirect(`/setup?ok=disconnected`);
  }
  return new Response('Not found', { status: 404 });
}

async function setup(env, url) {
  const [ttOk, gmOk] = await Promise.all([
    ticktickClient(env).connected().catch(() => false),
    gmailClient(env).connected().catch(() => false),
  ]);
  const err = url.searchParams.get('err');
  const ok = url.searchParams.get('ok');
  const notice = err ? { ok: false, text: `Connection failed: ${err}` }
    : ok === 'disconnected' ? { ok: true, text: 'Disconnected.' }
    : ok ? { ok: true, text: `${ok === 'google' ? 'Gmail' : 'TickTick'} connected.` } : null;
  return html(setupPage({
    mock: env.MOCK === '1',
    notice,
    missing: missingSecrets(env),
    ticktick: { connected: ttOk, configured: !!(env.TICKTICK_CLIENT_ID && env.TICKTICK_CLIENT_SECRET), redirect: redirectUri(url, 'ticktick') },
    gmail: { connected: gmOk, configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), redirect: redirectUri(url, 'google') },
  }));
}

// ── router ──

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secure = isSecure(url);

    // Public bits
    if (path === '/manifest.webmanifest') return new Response(MANIFEST, { headers: { 'Content-Type': 'application/manifest+json' } });
    if (path === '/icon.svg') return new Response(ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    if (path === '/login') {
      if (request.method === 'POST') {
        const form = await request.formData();
        const next = String(form.get('next') || '/');
        const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        if (await checkPasscode(env, String(form.get('passcode') || ''))) {
          return redirect(safeNext, { 'Set-Cookie': await sessionCookie(env, secure) });
        }
        await new Promise((r) => setTimeout(r, 600)); // slow down guessing
        return html(loginPage({ error: 'Wrong passcode', next: safeNext, missing: !env.APP_PASSCODE }), 401);
      }
      return html(loginPage({ next: url.searchParams.get('next') || '/', missing: !env.APP_PASSCODE }));
    }

    // Everything else needs a session
    if (!(await isAuthed(request, env))) {
      if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
      return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
    }

    try {
      if (path === '/logout' && request.method === 'POST') return redirect('/login', { 'Set-Cookie': clearSessionCookie(secure) });
      if (path === '/' || path === '/index.html') return html(INDEX_HTML);
      if (path === '/setup') return setup(env, url);
      const m = /^\/oauth\/(ticktick|google)\/(start|callback|disconnect)$/.exec(path);
      if (m) return oauth(request, env, url, m[1], m[2]);

      const method = request.method;
      if (path === '/api/tasks' && method === 'GET') return json(await buildDeck(env));
      if (path === '/api/tasks' && method === 'POST') return json(await apiAddTask(env, await body(request)));
      if (path === '/api/complete' && method === 'POST') return json(await apiComplete(env, await body(request)));
      if (path === '/api/dismiss' && method === 'POST') return json(await apiDismiss(env, await body(request)));
      if (path === '/api/meta' && method === 'POST') return json(await apiMeta(env, await body(request)));
      if (path === '/api/priority' && method === 'POST') return json(await apiPriority(env, await body(request)));
      if (path === '/api/session' && method === 'POST') return json(await apiSession(env, await body(request)));
      if (path === '/api/stats') return json(await apiStats(env));
      if (path === '/api/patterns') return json(await apiPatterns(env));
      if (path === '/api/delegations') return json(await apiDelegations(env));
      return new Response('Not found', { status: 404 });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof NotConnected) return json({ error: e.message, reconnect: true }, 409);
      console.error(e);
      return json({ error: e.message || 'server error' }, 500);
    }
  },
};
