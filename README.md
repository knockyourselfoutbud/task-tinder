# Task Tinder: TickTick + Gmail edition

A swipe deck over your real to-do list. Cards come from **TickTick** and **starred Gmail**, ordered by your TickTick priority. You filter by how much time and energy you have right now, swipe to triage, and play through what you accept against a timer, earning XP. When you finish a task you jot down what happened, so you build up a record of your own methods over time.

Forked from [loganhc-09/task-tinder](https://github.com/loganhc-09/task-tinder) by Logan Currie. The original keeps its own task list in a local SQLite database. This fork uses TickTick as the source of truth, runs on Cloudflare Workers so it works from your phone, and adds several changes aimed at ADHD.

## What's different from the original

| | Original | This fork |
|---|---|---|
| Where tasks live | Local SQLite with sample tasks | **TickTick** (all your lists, minus the ones you exclude) plus **starred Gmail** |
| Where it runs | `localhost:5050` on one PC | **Cloudflare Worker**: phone and PC, installable to the Android home screen |
| Order | Insertion order | **TickTick priority**: High → Medium → Low → none. Within a priority, overdue or due-soon tasks come first, then the oldest |
| Priority | — | Change it on any card (saved to TickTick), filter the deck by priority, and use **Sort mode** to set or clear priorities by swiping |
| Filters | 10/30/60 min (exact match) | **Priority lane** + **Time I have** (up to N minutes) + **Energy I have** (low/med/high) |
| Starting | Sprint only after 3 cards | **LET'S GO** opens a single-task in-play card with a 5/10/25-minute timer, and **DONE ✓** closes a card in one tap |
| Completing | Local DB only | Completes the task in **TickTick** / **unstars** the email |
| Delegate ⚡ | Writes `delegations.jsonl` | Adds a **`claude`** tag in TickTick so Claude (Cowork / Claude Code with the TickTick connector) can pick it up |

## Two modes

**Do mode** is for working through tasks.

- **Stats panel.** A daily-goal ring (tap it to change the goal), XP earned today, your combo multiplier with a countdown, and your level.
- **Strips.**
  - **ROUND** is a time-of-day suggestion. Tap **use** to apply its time and energy filters.
  - **COACH** is a one-line nudge.
  - **DUE** shows your most urgent overdue or due-today task, with **Jump to it**.
- **Priority lanes.** Tap **All / High / Med / Low / None / ★Mail** to work through one lane. If you have more than `HIGH_LIMIT` Highs (5 by default), a nudge links to Sort mode on High.
- **Card chips.** Tap the chips on a card to cycle through the options:
  - **Size:** S·10M, M·30M, L·60M. It sets the default timer.
  - **Priority:** saved to TickTick.
  - **Energy.**
- **More on each card.**
  - ✎ edits the title, first move, notes and due date in TickTick.
  - ⚡ hands the task to Claude.
  - High and Medium cards open for 14 days or more show a red "open N days" badge.
- **First move** is the smallest next step. It's saved as a `🎯 First move:` line in the TickTick notes. Tap the box to write it. When `ANTHROPIC_API_KEY` is set, a ✨ **suggest** button asks Claude for a draft.
- **🎲 Pick for me** puts the smallest top-priority card on top. The dots under the deck show how many cards you've closed.

**Sort mode** goes through one priority at a time. It starts on **Unsorted** (tasks with no priority), and you can switch to **High**, **Med** or **Low** to re-sort those. The count on the Sort tab is how many tasks have no priority. The "review Highs" nudge in Do mode opens Sort mode on High. Each card gets one swipe:

| Swipe | Button | Result |
|---|---|---|
| ↑ up | High | Sets priority to High in TickTick |
| → right | Medium | Sets priority to Medium |
| ↓ down | Low | Sets priority to Low |
| ← left | None | Removes the priority (sets it to none) |
| — | = keep | Leaves the priority as it is and moves on |

**Undo** reverses the last sort. On a keyboard, the arrow keys sort, space means "keep" and `z` undoes.

Starred emails show up as unsorted cards. When you give one a priority, it becomes a TickTick task that links back to the email, and the email is unstarred. From then on, TickTick is where it lives.

## How a card is described

- **Priority** is TickTick's own priority flag. Nothing is inferred.
- **Due badges** ("overdue 3 days", "due tomorrow") move a card up *within* its priority lane. They never change the priority.
- **Anchor**: tasks in an "Anchor Tasks" column get an anchor badge and sort first within their lane.
- **Effort** comes from the first of these that applies:
  1. What you tap on the card (10m / 30m / 60m).
  2. A TickTick tag: `10min`, `30min`, `60min`, `quick`, `big`, and so on.
  3. The column: a "Small" column means 10 min.
  4. A guess. Emails are guessed at 10 min, and guesses show with a dashed outline.
- **Energy** comes from what you tap on the card, or from the tags `energy-low`, `energy-med` and `energy-high`.

Cards with unknown effort or energy are never hidden by the time and energy filters. Tasks tagged `claude` (delegated to Claude) are left out of the deck.

## Do-mode actions

- **→ / LET'S GO** opens the black **in-play** card, which shows:
  - the first move;
  - a countdown timer (5 / 10 / 25 min, defaulting to the card's size);
  - a one-line "What happened?" box;
  - **DONE ✓**;
  - **shelve it**, which puts the card at the back of today's deck.
- **+ Queue it** lines a card up for a batch (up to 6). The queue shows above the deck with its total timer minutes and XP. Tap × to send a card back to the deck. **▶ Play batch** plays the queued cards back to back on the in-play card, each with its own timer, so the combo builds as you go. In a batch, **skip it** sends the card back to the deck and moves on, and **stop batch** keeps whatever's left in the queue for later. The queue is saved on the device.
- **DONE ✓** completes the task in TickTick, or unstars the email, straight from the deck. A one-line "What happened?" box slides up. You can fill it in or skip it.
- **← / NOT TODAY** hides the card until tomorrow. Nothing changes in TickTick.
- **Outcome notes** are saved in the app's history and also appended to the TickTick task as `✅ Done Sep 28: …` before it's completed.

### XP

| | XP |
|---|---|
| Size | S 10, M 25, L 50, unknown 15 |
| Priority bonus | High +10, Medium +5 |
| Combo | Each completion within 30 min of the last raises the multiplier (×2, then ×3 max) |
| Beat the clock | +8 for finishing an in-play task before its timer runs out |

Levels start at 0, 100, 300, 600, 1000, 1500… XP.

Desktop keyboard shortcuts: `→` let's go · `←` not today · `↑` or `q` queue · `d` done · `e` edit.

## Setup

See **[SETUP.md](SETUP.md)**. It takes about 20 minutes: you create a Cloudflare D1 database, register a TickTick developer app, create a Google OAuth client, set the secrets and deploy.

To try it locally with fake data:

```bash
npm install
cp .dev.vars.example .dev.vars   # MOCK=1, passcode "dev"
npm run dev                       # http://localhost:8787
```

## Layout

```
src/worker.js     routes, auth gate, API
src/triage.js     classification: priority lane, due/age badges, effort, energy, sort order
src/ticktick.js   TickTick Open API client + OAuth
src/gmail.js      Gmail API client + OAuth
src/auth.js       passcode login, signed session cookie
src/pages.js      login + /setup pages, PWA manifest/icon
src/index.html    the swipe UI (vanilla JS, no build step)
src/mock.js       fake TickTick/Gmail for MOCK=1
migrations/       D1 schema
test/             node --test unit tests for triage rules
```

## API

All endpoints need a signed-in session cookie.

| Endpoint | Method | Description |
|---|---|---|
| `/api/tasks` | GET | The deck: all cards plus the state of each source |
| `/api/tasks` | POST | `{title, effort?, energy?}` adds a task to the TickTick Inbox |
| `/api/complete` | POST | `{task_id, method_notes, time_taken_sec, timer_sec}` completes the task in TickTick (appending the note) or unstars the email. Returns XP and combo |
| `/api/dismiss` | POST | `{task_id, reason: skip\|delegate\|started, note?}` |
| `/api/meta` | POST | `{task_id, effort?, energy?}` stores your tags for a card |
| `/api/edit` | POST | `{task_id, title?, notes?, first_move?, due?}` edits a TickTick task |
| `/api/firstmove` | POST | `{task_id, text}` saves the first move |
| `/api/suggest` | POST | Drafts a first move with Claude (needs `ANTHROPIC_API_KEY`) |
| `/api/goal` | POST | `{goal}` sets the daily goal |
| `/api/priority` | POST | `{task_id, priority: 0\|1\|3\|5}` saves the priority to TickTick. For an email, it creates a TickTick task and unstars the email |
| `/api/stats` | GET | Goal, XP, level, combo and counts |
| `/api/patterns` | GET | Your "how I did it" notes (the learning data) |
| `/api/delegations` | GET | What you've handed to Claude |

## License

MIT (same as upstream).
