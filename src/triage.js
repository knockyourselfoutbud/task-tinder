// Turns raw TickTick tasks and starred Gmail threads into swipe cards:
// effort, energy, Eisenhower quadrant, and deck order.

export const EFFORTS = ['10min', '30min', '60min'];
export const ENERGIES = ['low', 'med', 'high'];
const EFFORT_MIN = { '10min': 10, '30min': 30, '60min': 60 };
const ENERGY_RANK = { low: 1, med: 2, high: 3 };

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

// ── Dates in the user's time zone ──

export function localDay(date, tz) {
  // YYYY-MM-DD in tz
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    const days = Math.round((new Date(today) - new Date(dueDay)) / 86400000);
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
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // markdown links
    .replace(/https?:\/\/\S+/g, '')             // bare urls
    .replace(/\\([_\-.*])/g, '$1')              // escaped md
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

export function quadrantOf(urgent, important) {
  if (urgent && important) return 'do';
  if (important) return 'schedule';
  if (urgent) return 'delegate';
  return 'later';
}
const QUADRANT_RANK = { do: 0, schedule: 1, delegate: 2, later: 3 };

// Projects whose tasks count as "important" by default
const IMPORTANT_PROJECT_HINTS = ['priorities', 'priority'];

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

  const priority = task.priority || 0;  // 0 none, 1 low, 3 med, 5 high
  const isAnchor = (column || '').toLowerCase().includes('anchor') || tl.includes('anchor');
  const important =
    tl.includes('important') ||
    priority >= 3 ||
    isAnchor ||
    IMPORTANT_PROJECT_HINTS.some((h) => projectName.toLowerCase().includes(h));
  const urgent = tl.includes('urgent') || (!!dueDay && dueDay <= tomorrow);

  const { text, url } = splitMarkdownLink(task.title);
  const { effort, guessed } = effortFrom({
    tags, column, source: 'ticktick', kind: task.kind,
    itemCount: (task.items || []).length, override: meta?.effort,
  });

  return {
    id: `tt:${task.projectId}:${task.id}`,
    source: 'ticktick',
    title: text || '(untitled)',
    link: url,
    context: plainSnippet(task.content || task.desc),
    project: projectName,
    column: column && column !== 'Not Sectioned' ? column : null,
    tags,
    effort,
    effortGuessed: guessed,
    energy: energyFrom({ tags, override: meta?.energy }),
    priority,
    urgent,
    important,
    anchor: isAnchor,
    quadrant: quadrantOf(urgent, important),
    due: dueDay,
    dueLabel: dueLabel(dueDay, today),
    overdue,
    sortOrder: task.sortOrder || 0,
    recurring: !!task.repeatFlag,
  };
}

export function cardFromEmail(thread, meta, cfg) {
  const important = thread.labelIds?.includes('IMPORTANT') || false;
  const urgent = true; // starred = someone is waiting on you
  const { effort, guessed } = effortFrom({ tags: [], source: 'email', override: meta?.effort });
  const received = thread.date ? localDay(new Date(thread.date), cfg.tz) : null;
  let ageLabel = '';
  if (received) {
    const days = Math.round((new Date(cfg.today) - new Date(received)) / 86400000);
    ageLabel = days <= 0 ? 'starred today' : days === 1 ? 'from yesterday' : `waiting ${days} days`;
  }
  return {
    id: `gm:${thread.threadId}`,
    source: 'email',
    title: thread.subject || '(no subject)',
    link: `https://mail.google.com/mail/u/0/#all/${thread.threadId}`,
    context: [thread.from, plainSnippet(thread.snippet, 130)].filter(Boolean).join(' — '),
    project: 'Starred',
    column: null,
    tags: [],
    effort,
    effortGuessed: guessed,
    energy: energyFrom({ tags: [], override: meta?.energy }),
    priority: 0,
    urgent,
    important,
    anchor: false,
    quadrant: quadrantOf(urgent, important),
    due: null,
    dueLabel: ageLabel,
    overdue: false,
    sortOrder: -(thread.internalDate || 0),
    recurring: false,
  };
}

// Deck order: Eisenhower quadrant → overdue → due date → priority → TickTick order
export function sortDeck(cards) {
  return cards.sort((a, b) =>
    (QUADRANT_RANK[a.quadrant] - QUADRANT_RANK[b.quadrant]) ||
    (Number(b.overdue) - Number(a.overdue)) ||
    ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) ||
    (b.priority - a.priority) ||
    (a.sortOrder - b.sortOrder)
  );
}

// Used by the client too (duplicated there) — kept here for tests
export function fitsFilters(card, budget, energy) {
  if (budget && budget !== 'all' && card.effort && EFFORT_MIN[card.effort] > EFFORT_MIN[budget]) return false;
  if (energy && energy !== 'all' && card.energy && ENERGY_RANK[card.energy] > ENERGY_RANK[energy]) return false;
  return true;
}
