# Task Tinder (TickTick + Gmail edition)

A swipe-style triage deck over TickTick and starred Gmail, running as a Cloudflare Worker with D1. It's forked from loganhc-09/task-tinder, which used Flask and SQLite.

## Architecture

- `src/worker.js` handles routing, the passcode gate and every `/api/*` handler. `buildDeck()` merges TickTick tasks with starred Gmail threads. It skips any email whose thread or message ID already appears in a TickTick task, then hides today's skips and recent delegations.
- `src/triage.js` holds the pure classification rules: the priority lane (straight from TickTick priority 5/3/1/0), due and age badges, effort, energy and sort order. Unit tests are in `test/`. Keep this file free of I/O.
- Priority changes (`/api/priority`) and Someday moves (`/api/someday`) write to TickTick immediately. Giving an email a priority turns it into a TickTick task and unstars it.
- The UI has two modes. **Do** works through tasks and can filter by lane. **Sort** prioritizes tasks that have no priority: swipe up for High, right for Medium, down for Low, left for Someday, and undo is available.
- `src/ticktick.js` and `src/gmail.js` are the API clients plus OAuth. Tokens live in the D1 `kv` table. TickTick updates always GET the full task and POST it back, so no fields get wiped.
- `src/index.html` is the single-page UI in vanilla JS. The Worker imports it as text. Filtering by time and energy happens on the client.
- `src/mock.js` holds fake data when `MOCK=1`. Don't put real personal data here, because the repo is public.

## D1 tables

- `kv`: OAuth tokens
- `task_meta`: effort and energy you set per card, keyed by `tt:<projectId>:<taskId>` or `gm:<threadId>`
- `dismissals`: `skip` (hidden until tomorrow), `delegate` (hidden for 7 days) and `started` (2-minute starts)
- `sessions`: sprint and two-minute sessions
- `completions`: the "how did you do it?" method notes (the learning data), with the task's `lane` at completion

## Delegation flow (for Claude)

When John taps ⚡ on a card:

- For a TickTick task, the task gets the tag **`claude`**. His optional note is appended to the task content as "🤖 For Claude: …".
- For a starred email, a new TickTick Inbox task `[subject](gmail link)` is created with the tag `claude`.

To pick up delegated work, use the TickTick connector:

1. Find open tasks tagged `claude`.
2. Do the work, or draft it for John to review. Don't send anything on his behalf without asking.
3. Complete the task in TickTick, or remove the `claude` tag and add a comment if John needs to finish it.

## Commands

```bash
npm run dev      # local, MOCK=1 via .dev.vars
npm test         # triage unit tests
npm run deploy   # applies D1 migrations remotely, then deploys
```
