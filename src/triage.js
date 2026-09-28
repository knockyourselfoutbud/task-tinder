// Turns raw TickTick tasks and starred Gmail threads into swipe cards.
// Priority is the backbone: TickTick's own priority flag decides the lane
// (high / med / low / none), and due dates only reorder within a lane.

export const EFFORTS = ['10min', '30min', '60min'];
export const ENERGIES = ['low', 'med', 'high'];
export const LANES = ['high', 'med', 'low', 'none'];
export const PRIORITY_OF_LANE = { high: 5, med: 3, low: 1, none: 0 };
const EFFORT_MIN = { '10min': 10, '30min': 30, '60min': 60 };
const ENERGY_RANK = { low: 1, med: 2, high: 3 };
const LANE_RANK = { high: 0, med: 1, low: 2, none: 3 };

// Days a High/Medium task can sit before the card calls it stale
export const STALE_DAYS = 14;

const EFFORT_TAGS = {
  '2min': '10min', '5min': '10min', '10min': '10min', quick: '10min', small: '10min',
  '15min': '30min', '20min': '30min', '30min': '30min', medium: '30min',
  '45min': '60min', '60min': '60min', '1h': '60min', big: '60min', deep: '60min',
};
const ENERGY_TAGS = {
  'energy-low': 'low', 'low-energy': 'low', lowenergy: 'low', easy: 'low',
  'energy-med': 'med', 'med-energy': 'med', 'energy-medium': 'med',
  'energy-high': 'high', 'high-energy': 'high', highenergy: 'high', focus: 'high',
};

export function laneOf(priority) {
  if (priority >= 5) return 'high';
  if (priority >= 3) return 'med';
  if (priority >= 1) return 'low';
  return 'none';
}

// ── Dates in the user's time zone ──

export function localDay(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDay, toDay) {
  return Math.round((new Date(toDay) - new Date(fromDay)) / 86400000);
}

// TickTick sends "2026-08-01T00:00:00-0400" (no colon in offset)
export function parseTickTickDate(s) {
  if (!s) return null;
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return isNaN(d) ? null : d;
}

function dueLabel(dueDay, today) {
  if (!dueDay) return '';
  if (dueDay < today) {
    const days = daysBetween(dueDay, today);
    return days === 1 ? 'overdue 1 day' : `overdue ${days} days`;
  }
  if (dueDay === today) return 'due today';
  if (dueDay === addDays(today, 1)) return 'due tomorrow';
  const d = new Date(dueDay + 'T12:00:00Z');
  return 'due ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Text helpers ──

// "[Estate Planning Follow-up](https://mail.google.com/...)" → { text, url }
export function splitMarkdownLink(title) {
  const m = /^\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(.*)$/.exec(title || '');
  if (!m) return { text: title || '', url: null };
  return { text: (m[1] + (m[3] ? ' ' + m[3] : '')).trim(), url: m[2] };
}

export function plainSnippet(s, max = 160) {
  if (!s) return '';
  let t = s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\\([_\-.*])/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t;
}

export function stripEmoji(name) {
  return (name || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
}

// ── Classification ──

function tagsLower(tags) {
  return (tags || []).map((t) => String(t).toLowerCase());
}

function effortFrom({ tags, column, source, kind, itemCount, override }) {
  if (override && EFFORT_MIN[override]) return { effort: override, guessed: false };
  for (const t of tagsLower(tags)) if (EFFORT_TAGS[t]) return { effort: EFFORT_TAGS[t], guessed: false };
  const col = (column || '').toLowerCase();
  if (col === 'small' || col === 'quick') return { effort: '10min', guessed: false };
  if (col === 'big' || col === 'large') return { effort: '60min', guessed: false };
  if (source === 'email') return { effort: '10min', guessed: true };
  if (kind === 'CHECKLIST' && itemCount > 3) return { effort: '30min', guessed: true };
  return { effort: null, guessed: true };
}

function energyFrom({ tags, override }) {
  if (override && ENERGY_RANK[override]) return override;
  for (const t of tagsLower(tags)) if (ENERGY_TAGS[t]) return ENERGY_TAGS[t];
  return null;
}

function ageLabel(days) {
  if (days == null) return '';
  if (days < 1) return 'added today';
  if (days === 1) return 'open 1 day';
  return `open ${days} days`;
}

export function cardFromTickTick(task, project, columnsById, meta, cfg) {
  const today = cfg.today;
  const tomorrow = addDays(today, 1);
  const tags = task.tags || [];
  const tl = tagsLower(tags);
  const column = task.columnId && columnsById ? columnsById[task.columnId] : null;
  const projectName = stripEmoji(project?.name || 'Inbox');

  const due = parseTickTickDate(task.dueDate);
  const dueDay = due ? localDay(due, cfg.tz) : null;
  const overdue = !!dueDay && dueDay < today;
  const dueSoon = !!dueDay && dueDay <= tomorrow;

  const created = parseTickTickDate(task.createdTime);
  const ageDays = created ? Math.max(0, daysBetween(localDay(created, cfg.tz), today)) : null;

  const priority = task.priority || 0;
  const lane = laneOf(priority);
  const isAnchor = (column || '').toLowerCase().includes('anchor') || tl.includes('anchor');

  const { text, url } = splitMarkdownLink(task.title);
  const { effort, guessed } = effortFrom({
    tags, column, source: 'ticktick', kind: task.kind,
    itemCount: (task.items || []).length, override: meta?.effort,
  });
  const { firstMove, rest } = extractFirstMove(task.content || task.desc || '');

  return {
    id: `tt:${task.projectId}:${task.id}`,
    source: 'ticktick',
    title: text || '(untitled)',
    link: url,
    context: plainSnippet(rest),
    notes: rest,
    firstMove,
    dueDate: dueDay,
    project: projectName,
    projectId: task.projectId,
    column: column && column !== 'Not Sectioned' ? column : null,
    tags,
    effort,
    effortGuessed: guessed,
    energy: energyFrom({ tags, override: meta?.energy }),
    priority,
    lane,
    anchor: isAnchor,
    due: dueDay,
    dueLabel: dueLabel(dueDay, today),
    overdue,
    dueSoon,
    ageDays,
    ageLabel: ageLabel(ageDays),
    stale: (lane === 'high' || lane === 'med') && ageDays != null && ageDays >= STALE_DAYS,
    sortOrder: task.sortOrder || 0,
    recurring: !!task.repeatFlag,
  };
}

export function cardFromEmail(thread, meta, cfg) {
  const { effort, guessed } = effortFrom({ tags: [], source: 'email', override: meta?.effort });
  const received = thread.date ? localDay(new Date(thread.date), cfg.tz) : null;
  const ageDays = received ? Math.max(0, daysBetween(received, cfg.today)) : null;
  return {
    id: `gm:${thread.threadId}`,
    source: 'email',
    title: thread.subject || '(no subject)',
    link: `https://mail.google.com/mail/u/0/#all/${thread.threadId}`,
    context: [thread.from, plainSnippet(thread.snippet, 130)].filter(Boolean).join(' — '),
    notes: '',
    firstMove: meta?.first_move || null,
    dueDate: null,
    project: 'Starred',
    projectId: null,
    column: null,
    tags: [],
    effort,
    effortGuessed: guessed,
    energy: energyFrom({ tags: [], override: meta?.energy }),
    // Emails have no priority until you give them one (which turns them into TickTick tasks)
    priority: 0,
    lane: 'none',
    gmailImportant: thread.labelIds?.includes('IMPORTANT') || false,
    anchor: false,
    due: null,
    dueLabel: '',
    overdue: false,
    dueSoon: false,
    ageDays,
    ageLabel: ageDays == null ? '' : ageDays < 1 ? 'starred today' : ageDays === 1 ? 'waiting 1 day' : `waiting ${ageDays} days`,
    stale: false,
    sortOrder: -(thread.internalDate || 0),
    recurring: false,
  };
}

// Deck order: lane → starred emails first (someone is waiting) → overdue → due soon → anchor → due date → oldest first → TickTick order
export function sortDeck(cards) {
  const dueKey = (c) => c.due || '9999-12-31';
  return cards.sort((a, b) =>
    (LANE_RANK[a.lane] - LANE_RANK[b.lane]) ||
    (Number(b.source === 'email') - Number(a.source === 'email')) ||
    (Number(b.overdue) - Number(a.overdue)) ||
    (Number(b.dueSoon) - Number(a.dueSoon)) ||
    (Number(b.anchor) - Number(a.anchor)) ||
    (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0) ||
    ((b.ageDays ?? -1) - (a.ageDays ?? -1)) ||
    (a.sortOrder - b.sortOrder)
  );
}

// Mirrors the client-side filter (kept here for tests)
export function fitsFilters(card, budget, energy, lane = 'all') {
  if (lane === 'email') { if (card.source !== 'email') return false; }
  else if (lane !== 'all' && card.lane !== lane) return false;
  if (budget && budget !== 'all' && card.effort && EFFORT_MIN[card.effort] > EFFORT_MIN[budget]) return false;
  if (energy && energy !== 'all' && card.energy && ENERGY_RANK[card.energy] > ENERGY_RANK[energy]) return false;
  return true;
}

// ── First move (stored as a line in the TickTick notes) ──

const FIRST_MOVE_RE = /^[ \t]*(?:🎯[ \t]*)?first move:[ \t]*(.+)$/im;

export function extractFirstMove(content) {
  const text = content || '';
  const m = FIRST_MOVE_RE.exec(text);
  if (!m) return { firstMove: null, rest: text };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/^\s*\n/, '').trim();
  return { firstMove: m[1].trim(), rest };
}

export function withFirstMove(content, firstMove) {
  const { rest } = extractFirstMove(content);
  const line = (firstMove || '').trim();
  if (!line) return rest;
  return `🎯 First move: ${line}` + (rest ? `\n\n${rest}` : '');
}

// ── Game layer ──

export const SIZE_OF_EFFORT = {
  '10min': { letter: 'S', label: 'S · 10M', timer: 5, xp: 10 },
  '30min': { letter: 'M', label: 'M · 30M', timer: 10, xp: 25 },
  '60min': { letter: 'L', label: 'L · 60M', timer: 25, xp: 50 },
};
const PRIORITY_XP = { high: 10, med: 5, low: 0, none: 0 };
export const BEAT_CLOCK_XP = 8;
export const MAX_COMBO = 3;

export function xpBase(card) {
  const size = SIZE_OF_EFFORT[card?.effort];
  return (size ? size.xp : 15) + (PRIORITY_XP[card?.lane] || 0);
}

export function xpAward(card, combo, beatClock) {
  return Math.round(xpBase(card) * Math.min(Math.max(combo || 1, 1), MAX_COMBO)) + (beatClock ? BEAT_CLOCK_XP : 0);
}

const LEVEL_NAMES = ['Warming Up', 'In the Zone', 'On a Roll', 'Locked In', 'Unstoppable', 'Legend'];

// Level n starts at 50·n·(n-1) XP: 0, 100, 300, 600, 1000, 1500…
export function levelFor(totalXp) {
  const xp = Math.max(0, totalXp || 0);
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  const start = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return {
    level,
    name: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)],
    into: xp - start,
    span: next - start,
    toNext: next - xp,
  };
}
