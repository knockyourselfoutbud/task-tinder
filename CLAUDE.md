# Task Tinder (TickTick + Gmail edition)

A swipe-style triage deck over TickTick and starred Gmail, running as a Cloudflare Worker with D1. It's forked from loganhc-09/task-tinder, which used Flask and SQLite.

## Architecture

- `src/worker.js` handles routing, the passcode gate and every `/api/*` handler. `buildDeck()` merges TickTick tasks with starred Gmail threads. It skips any email whose thread or message ID already appears in a TickTick task, then hides today's skips and recent delegations.
- `src/triage.js` holds the pure classification rules: the priority lane (straight from TickTick priority 5/3/1/0), due and age badges, effort, energy and sort order. Unit tests are in `test/`. Keep this file free of I/O.
- Priority changes (`/api/priority`) write to TickTick immediately. Giving an email a priority turns it into a TickTick task and unstars it.
- First move is stored as a `🎯 First move:` line in the TickTick notes (parsed by `extractFirstMove`). For emails it's stored in `task_meta.first_move`. `/api/edit` edits the title (keeping any Gmail link), notes, first move and due date. `/api/suggest` calls the Anthropic API when `ANTHROPIC_API_KEY` is set.
- The game layer is computed server-side in `apiComplete`/`apiStats`. XP comes from `xpAward` in triage.js. The combo window is 30 min (max ×3). Beat the clock is +8. The daily goal is stored in `kv`.
- The UI has two modes. **Do** works through tasks and can filter by lane. LET'S GO opens the black in-play card (timer, first move, outcome, done, shelve). DONE ✓ completes a card straight from the deck. "+ Queue" lines cards up (client-side, localStorage `tt_queue`, max 6). "Play batch" walks them through the in-play card one by one and logs a `sessions` row. **Sort** goes through one lane at a time (Unsorted, High, Med or Low): swipe up for High, right for Medium, down for Low, left for no priority. There's also a "keep" button and undo.
- `src/ticktick.js` and `src/gmail.js` are the API clients plus OAuth. Tokens live in the D1 `kv` table. TickTick updates always GET the full task and POST it back, so no fields get wiped.
- `src/index.html` is the single-page UI in vanilla JS. The Worker imports it as text. Filtering by time and energy happens on the client.
- `src/mock.js` holds fake data when `MOCK=1`. Don't put real personal data here, because the repo is public.

## D1 tables

- `kv`: OAuth tokens
- `task_meta`: effort, energy and (for emails) first move that you set per card, keyed by `tt:<projectId>:<taskId>` or `gm:<threadId>`
- `dismissals`: `skip` (hidden until tomorrow), `delegate` (hidden for 7 days) and `started` (2-minute starts)
- `sessions`: sprint and two-minute sessions
- `completions`: the "what happened?" outcome notes (the learning data), plus `lane`, `xp`, `combo`, `beat_clock` and local `day`

## Delegation flow (for Claude)

When John taps ⚡ on a card:

- For a TickTick task, the task gets the tag **`claude`**. His optional note is appended to the task content as "🤖 For Claude: …".
- For a starred email, a new TickTick Inbox task `[subject](gmail link)` is created with the tag `claude`.

A scheduled Claude run (twice a day) picks these up with the TickTick connector. The hand-back contract that the app relies on:

1. Find open tasks tagged `claude`. Skip tasks tagged only `claude-review`, because those are waiting on John.
2. What Claude may do: research and summarize, draft emails as **Gmail drafts** (never send), and break the task into steps (a checklist or subtasks plus a first move). What Claude must not do: send anything, change the calendar, buy anything, delete tasks, or change priority or due date.
3. Append to the task content, keeping everything already there:
   ```
   🤖 Claude did (Oct 5): <one-line summary>
   - details…
   ```
   The app shows the latest `🤖 Claude did` line on the card. If there's no `🎯 First move:` line, Claude may add one as the first line, covering John's next step.
4. Swap the tag `claude` → `claude-review` and keep the other tags. The card comes back at the top of John's deck with a 🤖 box. **got it** removes `claude-review` (`/api/reviewed`), and ⚡ sends the task back to Claude.

## Commands

```bash
npm run dev      # local, MOCK=1 via .dev.vars
npm test         # triage unit tests
npm run deploy   # applies D1 migrations remotely, then deploys
```
