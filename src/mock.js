// In-memory stand-ins for TickTick and Gmail. Used when MOCK=1
// (local `npm run dev`) so you can try the UI without connecting anything.
// Data is built on first use: in Workers, Date.now() is 0 at module load.

function isoIn(days) {
  const d = new Date(Date.now() + days * 86400000);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}T00:00:00-0400`;
}

const projects = [
  { id: 'p-admin', name: '💻Admin', kind: 'TASK' },
  { id: 'p-house', name: '🏡House Projects', kind: 'TASK' },
  { id: 'p-errands', name: '🚘Errands', kind: 'TASK' },
  { id: 'p-prio', name: '🎯2026 Priorities', kind: 'TASK' },
  { id: 'p-work', name: '✴️Work', kind: 'TASK' },
  { id: 'p-someday', name: '📅Someday', kind: 'TASK' },
  { id: 'p-notes', name: 'Research', kind: 'NOTE' },
];

const columns = {
  'p-admin': [
    { id: 'c-small', name: 'Small' },
    { id: 'c-anchor', name: 'Anchor Tasks' },
    { id: 'c-none', name: 'Not Sectioned' },
  ],
};

let tasks = null;
let threads = null;

function seed() {
  if (tasks) return;
  tasks = [
    { id: 't1', projectId: 'inbox', title: 'Call dentist to reschedule cleaning', priority: 0, dueDate: isoIn(0), tags: ['10min'] },
    { id: 't2', projectId: 'p-admin', title: 'Renew car registration', priority: 5, dueDate: isoIn(-2), columnId: 'c-small' },
    { id: 't3', projectId: 'p-admin', title: 'Review homeowner insurance renewal', priority: 3, columnId: 'c-anchor', content: 'Compare deductible options before the renewal date.' },
    { id: 't4', projectId: 'p-admin', title: '[Invoice from plumbing company](https://mail.google.com/mail/u/0/#all/abc123)', priority: 0, content: 'Invoice is due net 30. Pay online through the portal.', columnId: 'c-small' },
    { id: 't5', projectId: 'p-house', title: 'Winterize the hose bibs', priority: 3, dueDate: isoIn(12), tags: ['energy-high', '60min'] },
    { id: 't6', projectId: 'p-house', title: 'Order replacement furnace filter', priority: 0, tags: ['energy-low'] },
    { id: 't7', projectId: 'p-errands', title: 'Drop off library books', priority: 0, dueDate: isoIn(1) },
    { id: 't8', projectId: 'p-prio', title: 'Draft questions for the tax accountant', priority: 0, kind: 'CHECKLIST', items: [{}, {}, {}, {}, {}] },
    { id: 't9', projectId: 'p-work', title: 'Work item that should be excluded', priority: 5 },
    { id: 't10', projectId: 'p-someday', title: 'Learn to bake sourdough', priority: 0 },
    { id: 't11', projectId: 'inbox', title: 'Sign up for fall tournament volunteer slots', priority: 1, dueDate: isoIn(5) },
    { id: 't12', projectId: 'p-house', title: 'Clean gutters', priority: 0, dueDate: isoIn(-6), tags: ['energy-high'] },
  ];

  threads = [
    { threadId: 'th-1', messageId: 'm-1', subject: 'Permission slip for field trip', from: 'School Office', snippet: 'Please sign and return the attached form by Friday.', internalDate: Date.now() - 2 * 86400000, labelIds: ['STARRED', 'IMPORTANT', 'INBOX'] },
    { threadId: 'th-2', messageId: 'm-2', subject: 'Re: Saturday pickup game', from: 'Dave', snippet: 'Are you in for Saturday? Need a headcount by tonight.', internalDate: Date.now() - 3600000, labelIds: ['STARRED', 'INBOX'] },
    { threadId: 'abc123', messageId: 'm-3', subject: 'Your invoice from plumbing company', from: 'Plumbing Co', snippet: 'Duplicate of a TickTick task — should be hidden.', internalDate: Date.now() - 5 * 86400000, labelIds: ['STARRED'] },
  ];
}

export const mockTickTick = {
  async connected() { return true; },
  async listProjects() { seed(); return projects.map((p) => ({ ...p })); },
  async projectData(projectId) {
    seed();
    return {
      project: projects.find((p) => p.id === projectId) || { id: 'inbox', name: 'Inbox' },
      tasks: tasks.filter((t) => t.projectId === projectId && !t.done),
      columns: columns[projectId] || [],
    };
  },
  async getTask(projectId, taskId) { seed(); return { ...tasks.find((t) => t.id === taskId && t.projectId === projectId) }; },
  async complete(projectId, taskId) { seed(); const t = tasks.find((x) => x.id === taskId); if (t) t.done = true; return null; },
  async update(task) { seed(); tasks = tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)); return task; },
  async create(task) { seed(); const t = { id: 'n' + Date.now(), priority: 0, ...task }; tasks.push(t); return t; },
};

export const mockGmail = {
  async connected() { return true; },
  async starredThreads() { seed(); return threads.map((t) => ({ ...t, date: t.internalDate })); },
  async unstarThread(threadId) { seed(); threads = threads.filter((t) => t.threadId !== threadId); return {}; },
};
