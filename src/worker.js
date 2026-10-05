// Task Tinder — Cloudflare Worker backend (TickTick + starred Gmail edition)
import INDEX_HTML from './index.html';
import {
  isAuthed, checkPasscode, sessionCookie, clearSessionCookie, getCookie, cookieHeader, randomState,
} from './auth.js';
import { loginPage, setupPage, privacyPage, termsPage, MANIFEST, ICON_SVG } from './pages.js';
import { ticktickClient, ticktickAuthUrl, ticktickExchangeCode, NotConnected } from './ticktick.js';
import { gmailClient, googleAuthUrl, googleExchangeCode } from './gmail.js';
import {
  cardFromTickTick, cardFromEmail, sortDeck, localDay, stripEmoji, EFFORTS, ENERGIES, PRIORITY_OF_LANE,
  splitMarkdownLink, withFirstMove, xpAward, levelFor, MAX_COMBO,
} from './triage.js';
import { kvGet, kvSet, kvDelete } from './store.js';

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
    env.DB.prepare('SELECT task_key, effort, energy, first_move FROM task_meta').all(),
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
    let dupes = 0;
    for (const th of threads) {
      // Skip emails you've already turned into TickTick tasks (link contains the id)
      if (ttText.includes(th.threadId) || (th.messageId && ttText.includes(th.messageId))) { dupes++; continue; }
      const card = cardFromEmail(th, meta[`gm:${th.threadId}`], c);
      if (!hidden.has(card.id)) cards.push(card);
    }
    sources.gmail = { status: 'ok', fetched: threads.length, alreadyInTickTick: dupes };
  } catch (e) {
    sources.gmail = { status: e instanceof NotConnected ? 'not_connected' : 'error', note: e.message };
  }

  return {
    tasks: sortDeck(cards),
    sources,
    today: c.today,
    sprintSize: parseInt(env.SPRINT_SIZE || '3', 10) || 3,
    highLimit: parseInt(env.HIGH_LIMIT || '5', 10) || 5,
    features: { suggest: !!env.ANTHROPIC_API_KEY },
  };
}

// ── API handlers ──

function shortDate(tz) {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
}

const COMBO_WINDOW_MIN = 30;

async function apiComplete(env, data) {
  const k = parseKey(data.task_id);
  if (!k) throw new HttpError(400, 'task_id required');
  const c = cfg(env);
  const note = String(data.method_notes || '').trim().slice(0, 500);

  if (k.source === 'ticktick') {
    const tt = ticktickClient(env);
    if (note) {
      // Keep the outcome with the task in TickTick too
      const full = await tt.getTask(k.projectId, k.taskId);
      full.content = `${full.content ? full.content.trimEnd() + '\n\n' : ''}✅ Done ${shortDate(c.tz)}: ${note}`;
      await tt.update(full);
    }
    await tt.complete(k.projectId, k.taskId);
  } else {
    await gmailClient(env).unstarThread(k.threadId);
  }

  // Combo: another completion within the window keeps the chain going
  const last = await env.DB.prepare(
    `SELECT combo, (julianday('now') - julianday(completed_at)) * 1440 AS mins FROM completions ORDER BY id DESC LIMIT 1`
  ).first();
  const combo = last && last.mins <= COMBO_WINDOW_MIN ? Math.min((last.combo || 1) + 1, MAX_COMBO) : 1;
  const taken = Math.max(0, parseInt(data.time_taken_sec || 0, 10) || 0);
  const timer = Math.max(0, parseInt(data.timer_sec || 0, 10) || 0);
  const beat = timer > 0 && taken > 0 && taken <= timer ? 1 : 0;
  const t = data.task || {};
  const xp = xpAward(t, combo, beat);

  await env.DB.prepare(
    `INSERT INTO completions (task_key, task_title, source, project, lane, effort, energy, method_notes, time_taken_sec, session_id, xp, combo, beat_clock, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.task_id, t.title || '', k.source, t.project || '', t.lane || '', t.effort || '', t.energy || '',
    note, taken, data.session_id || null, xp, combo, beat, c.today
  ).run();
  return { ok: true, xp, combo, beat_clock: !!beat, stats: await apiStats(env) };
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
  const [done, doneToday, delegated, xpAll, xpToday, last, goal] = await Promise.all([
    q('SELECT COUNT(*) n FROM completions'),
    q(`SELECT COUNT(*) n FROM completions WHERE COALESCE(day, date(completed_at)) = ?`, today),
    q(`SELECT COUNT(*) n FROM dismissals WHERE reason = 'delegate'`),
    q('SELECT COALESCE(SUM(xp), 0) n FROM completions'),
    q(`SELECT COALESCE(SUM(xp), 0) n FROM completions WHERE COALESCE(day, date(completed_at)) = ?`, today),
    q(`SELECT combo, (julianday('now') - julianday(completed_at)) * 1440 AS mins FROM completions ORDER BY id DESC LIMIT 1`),
    kvGet(env, 'daily_goal'),
  ]);
  const comboLive = last && last.mins <= COMBO_WINDOW_MIN;
  return {
    completed: done.n,
    completed_today: doneToday.n,
    delegated: delegated.n,
    goal: goal || 6,
    xp_total: xpAll.n,
    xp_today: xpToday.n,
    level: levelFor(xpAll.n),
    combo: comboLive ? last.combo || 1 : 1,
    combo_expires_in_sec: comboLive ? Math.max(0, Math.round((COMBO_WINDOW_MIN - last.mins) * 60)) : 0,
  };
}

async function apiGoal(env, data) {
  const goal = Math.round(Number(data.goal));
  if (!(goal >= 1 && goal <= 30)) throw new HttpError(400, 'goal must be 1–30');
  await kvSet(env, 'daily_goal', goal);
  return { ok: true, goal };
}

// ── Editing ──

// Offset like "-0400" for a calendar date in the user's time zone
function tzOffset(tz, day) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? `${m[1]}${m[2]}${m[3] || '00'}` : '+0000';
}

async function apiEdit(env, data) {
  const k = parseKey(data.task_id);
  if (!k || k.source !== 'ticktick') throw new HttpError(400, 'Only TickTick tasks can be edited');
  const c = cfg(env);
  const tt = ticktickClient(env);
  const full = await tt.getTask(k.projectId, k.taskId);

  if (typeof data.title === 'string' && data.title.trim()) {
    const { url } = splitMarkdownLink(full.title);
    const title = data.title.trim().replace(/[\[\]]/g, '');
    full.title = url ? `[${title}](${url})` : data.title.trim();
  }
  if (typeof data.notes === 'string') {
    // Notes edits keep the first-move line intact
    const fm = data.first_move !== undefined ? data.first_move : (/(?:🎯\s*)?first move:\s*(.+)/i.exec(full.content || '') || [])[1];
    full.content = withFirstMove(data.notes, fm || '');
  } else if (data.first_move !== undefined) {
    full.content = withFirstMove(full.content || '', data.first_move || '');
  }
  if (data.due !== undefined) {
    if (data.due && /^\d{4}-\d{2}-\d{2}$/.test(data.due)) {
      const iso = `${data.due}T00:00:00.000${tzOffset(c.tz, data.due)}`;
      full.dueDate = iso;
      full.startDate = iso;
      full.isAllDay = true;
      full.timeZone = full.timeZone || c.tz;
    } else {
      full.dueDate = null;
      full.startDate = null;
    }
  }
  await tt.update(full);
  return { ok: true, card: cardFromTickTick(full, { name: data.project || 'Inbox' }, {}, null, c) };
}

async function apiFirstMove(env, data) {
  const k = parseKey(data.task_id);
  if (!k) throw new HttpError(400, 'task_id required');
  const text = String(data.text || '').trim().slice(0, 300);
  if (k.source === 'ticktick') {
    const tt = ticktickClient(env);
    const full = await tt.getTask(k.projectId, k.taskId);
    full.content = withFirstMove(full.content || '', text);
    await tt.update(full);
  } else {
    await env.DB.prepare(
      `INSERT INTO task_meta (task_key, first_move, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(task_key) DO UPDATE SET first_move = excluded.first_move, updated_at = excluded.updated_at`
    ).bind(data.task_id, text || null).run();
  }
  return { ok: true, first_move: text || null };
}

// ✨ Draft a first move with Claude (only when ANTHROPIC_API_KEY is set)
async function apiSuggest(env, data) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(404, 'Suggestions are off — set ANTHROPIC_API_KEY');
  const t = data.task || {};
  const prompt = [
    `Task: ${t.title || ''}`,
    t.project ? `List: ${t.project}` : '',
    t.context ? `Notes/context: ${String(t.context).slice(0, 800)}` : '',
  ].filter(Boolean).join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.AI_MODEL || 'claude-haiku-4-5',
      max_tokens: 120,
      system:
        'You help someone with ADHD start tasks. Reply with ONE concrete first move that takes under 2 minutes ' +
        'and needs no decisions before starting — a physical, specific action (open X, text Y, write one line). ' +
        'Max 20 words. No preamble, no quotes.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const why = (err.error && err.error.message) || '';
    throw new HttpError(502, `Claude couldn't suggest (${r.status})${why ? ': ' + why.slice(0, 160) : ''}`);
  }
  const out = await r.json();
  const text = (out.content || []).map((b) => b.text || '').join('').trim().replace(/^["']|["']$/g, '');
  return { ok: true, suggestion: text };
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
    if (path === '/privacy') return html(privacyPage(url.origin), 200, { 'Cache-Control': 'public, max-age=3600' });
    if (path === '/terms') return html(termsPage(url.origin), 200, { 'Cache-Control': 'public, max-age=3600' });
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
      if (path === '/api/edit' && method === 'POST') return json(await apiEdit(env, await body(request)));
      if (path === '/api/firstmove' && method === 'POST') return json(await apiFirstMove(env, await body(request)));
      if (path === '/api/suggest' && method === 'POST') return json(await apiSuggest(env, await body(request)));
      if (path === '/api/goal' && method === 'POST') return json(await apiGoal(env, await body(request)));
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
