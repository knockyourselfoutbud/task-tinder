import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardFromTickTick, cardFromEmail, sortDeck, fitsFilters, splitMarkdownLink, parseTickTickDate, stripEmoji, laneOf,
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
  assert.equal(stripEmoji('📅Someday'), 'Someday');
});

test('lanes come straight from TickTick priority', () => {
  assert.equal(laneOf(5), 'high');
  assert.equal(laneOf(3), 'med');
  assert.equal(laneOf(1), 'low');
  assert.equal(laneOf(0), 'none');
  const c = cardFromTickTick({ id: 'a', projectId: 'p1', title: 'Hot tub', priority: 5 }, proj, {}, null, cfg);
  assert.equal(c.lane, 'high');
  assert.equal(c.dueLabel, '');
});

test('due dates badge but do not change lane', () => {
  const c = cardFromTickTick({ id: 'a', projectId: 'p1', title: 'x', priority: 0, dueDate: '2026-09-20T00:00:00-0400' }, proj, {}, null, cfg);
  assert.equal(c.lane, 'none');
  assert.equal(c.overdue, true);
  assert.equal(c.dueLabel, 'overdue 7 days');
  const t = cardFromTickTick({ id: 'b', projectId: 'p1', title: 'x', dueDate: '2026-09-28T00:00:00-0400' }, proj, {}, null, cfg);
  assert.equal(t.dueSoon, true);
  assert.equal(t.dueLabel, 'due tomorrow');
});

test('age + stale', () => {
  const old = cardFromTickTick({ id: 'a', projectId: 'p1', title: 'Punchlist', priority: 5, createdTime: '2026-06-09T12:55:58-0400' }, proj, {}, null, cfg);
  assert.equal(old.ageDays, 110);
  assert.equal(old.ageLabel, 'open 110 days');
  assert.equal(old.stale, true);
  const fresh = cardFromTickTick({ id: 'b', projectId: 'p1', title: 'x', priority: 5, createdTime: '2026-09-25T22:41:42-0400' }, proj, {}, null, cfg);
  assert.equal(fresh.stale, false);
  const lowOld = cardFromTickTick({ id: 'c', projectId: 'p1', title: 'x', priority: 1, createdTime: '2026-01-01T00:00:00-0500' }, proj, {}, null, cfg);
  assert.equal(lowOld.stale, false);
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

test('email cards start unsorted', () => {
  const c = cardFromEmail({ threadId: 't1', subject: 'Hi', from: 'Sam', snippet: 'hello', internalDate: Date.parse('2026-09-24T15:00:00Z'), date: Date.parse('2026-09-24T15:00:00Z'), labelIds: ['IMPORTANT'] }, null, cfg);
  assert.equal(c.lane, 'none');
  assert.equal(c.gmailImportant, true);
  assert.equal(c.effort, '10min');
  assert.equal(c.ageLabel, 'waiting 3 days');
});

test('filters: lane, unknown effort/energy always shown, bigger hidden', () => {
  assert.equal(fitsFilters({ lane: 'high', effort: null, energy: null }, '10min', 'low'), true);
  assert.equal(fitsFilters({ lane: 'high', effort: '30min', energy: null }, '10min', 'all'), false);
  assert.equal(fitsFilters({ lane: 'med', effort: '10min', energy: 'high' }, '30min', 'med'), false);
  assert.equal(fitsFilters({ lane: 'med', effort: '10min', energy: 'low' }, '30min', 'med'), true);
  assert.equal(fitsFilters({ lane: 'med' }, 'all', 'all', 'high'), false);
  assert.equal(fitsFilters({ lane: 'high' }, 'all', 'all', 'high'), true);
});

test('sort: high → med → low → none; overdue, then oldest first within a lane', () => {
  const mk = (id, lane, extra = {}) => ({ id, lane, overdue: false, dueSoon: false, anchor: false, due: null, ageDays: 1, sortOrder: 0, ...extra });
  const out = sortDeck([
    mk('none', 'none', { overdue: true, due: '2026-09-01' }),
    mk('low', 'low'),
    mk('h-new', 'high', { ageDays: 0 }),
    mk('h-old', 'high', { ageDays: 110 }),
    mk('h-over', 'high', { overdue: true, due: '2026-09-20' }),
    mk('med', 'med'),
  ]);
  assert.deepEqual(out.map((c) => c.id), ['h-over', 'h-old', 'h-new', 'med', 'low', 'none']);
});
