import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardFromTickTick, cardFromEmail, sortDeck, fitsFilters, splitMarkdownLink, parseTickTickDate, stripEmoji,
} from '../src/triage.js';

const cfg = { tz: 'America/New_York', today: '2026-09-27' };
const proj = { id: 'p1', name: '💻Admin' };

test('markdown link titles split into text + url', () => {
  assert.deepEqual(splitMarkdownLink('[Invoice](https://mail.google.com/x)'), { text: 'Invoice', url: 'https://mail.google.com/x' });
  assert.deepEqual(splitMarkdownLink('Plain title'), { text: 'Plain title', url: null });
});

test('TickTick dates without offset colon parse', () => {
  assert.equal(parseTickTickDate('2026-08-01T00:00:00-0400').toISOString(), '2026-08-01T04:00:00.000Z');
});

test('stripEmoji', () => {
  assert.equal(stripEmoji('✴️Work'), 'Work');
  assert.equal(stripEmoji('🎯2026 Priorities'), '2026 Priorities');
});

test('quadrants', () => {
  const overdueHigh = cardFromTickTick({ id: 'a', projectId: 'p1', title: 'x', priority: 5, dueDate: '2026-09-20T00:00:00-0400' }, proj, {}, null, cfg);
  assert.equal(overdueHigh.quadrant, 'do');
  assert.equal(overdueHigh.overdue, true);
  assert.equal(overdueHigh.dueLabel, 'overdue 7 days');

  const importantLater = cardFromTickTick({ id: 'b', projectId: 'p1', title: 'x', priority: 3, dueDate: '2026-10-15T00:00:00-0400' }, proj, {}, null, cfg);
  assert.equal(importantLater.quadrant, 'schedule');

  const dueTomorrow = cardFromTickTick({ id: 'c', projectId: 'p1', title: 'x', priority: 0, dueDate: '2026-09-28T00:00:00-0400' }, proj, {}, null, cfg);
  assert.equal(dueTomorrow.quadrant, 'delegate');
  assert.equal(dueTomorrow.dueLabel, 'due tomorrow');

  const nothing = cardFromTickTick({ id: 'd', projectId: 'p1', title: 'x', priority: 0 }, proj, {}, null, cfg);
  assert.equal(nothing.quadrant, 'later');

  const anchor = cardFromTickTick({ id: 'e', projectId: 'p1', title: 'x', columnId: 'c1' }, proj, { c1: 'Anchor Tasks' }, null, cfg);
  assert.equal(anchor.anchor, true);
  assert.equal(anchor.quadrant, 'schedule');

  const prio = cardFromTickTick({ id: 'f', projectId: 'p2', title: 'x' }, { id: 'p2', name: '🎯2026 Priorities' }, {}, null, cfg);
  assert.equal(prio.important, true);
});

test('effort + energy from tags, columns, overrides', () => {
  const small = cardFromTickTick({ id: 'a', projectId: 'p1', title: 'x', columnId: 's' }, proj, { s: 'Small' }, null, cfg);
  assert.equal(small.effort, '10min');
  assert.equal(small.effortGuessed, false);
  const tagged = cardFromTickTick({ id: 'b', projectId: 'p1', title: 'x', tags: ['60min', 'energy-low'] }, proj, {}, null, cfg);
  assert.equal(tagged.effort, '60min');
  assert.equal(tagged.energy, 'low');
  const over = cardFromTickTick({ id: 'c', projectId: 'p1', title: 'x', tags: ['60min'] }, proj, {}, { effort: '10min', energy: 'high' }, cfg);
  assert.equal(over.effort, '10min');
  assert.equal(over.energy, 'high');
});

test('email cards', () => {
  const c = cardFromEmail({ threadId: 't1', subject: 'Hi', from: 'Sam', snippet: 'hello', internalDate: Date.parse('2026-09-24T15:00:00Z'), date: Date.parse('2026-09-24T15:00:00Z'), labelIds: ['IMPORTANT'] }, null, cfg);
  assert.equal(c.quadrant, 'do');
  assert.equal(c.effort, '10min');
  assert.equal(c.effortGuessed, true);
  assert.equal(c.dueLabel, 'waiting 3 days');
  const c2 = cardFromEmail({ threadId: 't2', subject: 'Hi', labelIds: [] }, null, cfg);
  assert.equal(c2.quadrant, 'delegate');
});

test('filters: unknown effort/energy always shown, bigger hidden', () => {
  assert.equal(fitsFilters({ effort: null, energy: null }, '10min', 'low'), true);
  assert.equal(fitsFilters({ effort: '30min', energy: null }, '10min', 'all'), false);
  assert.equal(fitsFilters({ effort: '10min', energy: 'high' }, '30min', 'med'), false);
  assert.equal(fitsFilters({ effort: '10min', energy: 'low' }, '30min', 'med'), true);
});

test('sort: do → schedule → delegate → later, overdue first', () => {
  const mk = (id, quadrant, extra = {}) => ({ id, quadrant, overdue: false, due: null, priority: 0, sortOrder: 0, ...extra });
  const out = sortDeck([mk('l', 'later'), mk('d2', 'do'), mk('s', 'schedule'), mk('d1', 'do', { overdue: true, due: '2026-09-01' }), mk('q', 'delegate')]);
  assert.deepEqual(out.map((c) => c.id), ['d1', 'd2', 's', 'q', 'l']);
});
