# Task Tinder: TickTick + Gmail edition

A swipe deck over your real to-do list. Cards come from **TickTick** and **starred Gmail**, ordered by your TickTick priority. You filter by how much time and energy you have right now, swipe to triage, and sprint through what you accept. When you finish a task you jot down *how* you did it, so you build up a record of your own methods over time.

Forked from [loganhc-09/task-tinder](https://github.com/loganhc-09/task-tinder) by Logan Currie. The original keeps its own task list in a local SQLite database. This fork uses TickTick as the source of truth, runs on Cloudflare Workers so it works from your phone, and adds several changes aimed at ADHD.

## What's different from the original

| | Original | This fork |
|---|---|---|
| Where tasks live | Local SQLite with sample tasks | **TickTick** (all your lists, minus the ones you exclude) plus **starred Gmail** |
| Where it runs | `localhost:5050` on one PC | **Cloudflare Worker**: phone and PC, installable to the Android home screen |
| Order | Insertion order | **TickTick priority**: High → Medium → Low → none. Within a priority, overdue or due-soon tasks come first, then the oldest |
| Priority | — | Change it on any card (saved to TickTick), filter the deck by priority, and use **Sort mode** to prioritize the unsorted pile by swiping |
| Filters | 10/30/60 min (exact match) | **Priority lane** + **Time I have** (up to N minutes) + **Energy I have** (low/med/high) |
| Starting | Sprint only after 3 cards | **Start after 1 card**, plus a **"just 2 minutes"** button on every card |
| Completing | Local DB only | Completes the task in **TickTick** / **unstars** the email |
| Delegate ⚡ | Writes `delegations.jsonl` | Adds a **`claude`** tag in TickTick so Claude (Cowork / Claude Code with the TickTick connector) can pick it up |

## Two modes

**Do mode** is for working through tasks.

- The lane strip at the top shows counts for **All / High / Med / Low / None**. Tap a lane to work through only those tasks.
- Every card has a **priority** row (High, Med, Low, –). A change is saved to TickTick immediately, so your lists and widgets always match.
- When you have more than `HIGH_LIMIT` Highs (5 by default), a nudge suggests you review them.
- High and Medium cards that have been open for 14 days or more show a red "open N days" badge.

**Sort mode** is for tasks that have no priority yet. The count on the Sort tab tells you how many are waiting. Each card gets one swipe:

| Swipe | Button | Result |
|---|---|---|
| ↑ up | High | Sets priority 5 in TickTick |
| → right | Medium | Sets priority 3 |
| ↓ down | Low | Sets priority 1 |
| ← left | Someday | Moves the task to your TickTick "Someday" list (or tags it `someday` if the move fails). It then leaves the deck. |
| — | ? not sure | Sets the card aside for this session |

**Undo** reverses the last sort. On a keyboard, the arrow keys sort, space means "not sure" and `z` undoes.

Starred emails show up as unsorted cards. When you give one a priority (or send it to Someday), it becomes a TickTick task that links back to the email, and the email is unstarred. From then on, TickTick is where it lives.

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

Cards with unknown effort or energy are never hidden by the time and energy filters. Tasks tagged `claude` (delegated) or `someday` (parked) are left out of the deck.

## Do-mode swipes

- **→ / ✓ Queue:** adds the card to your sprint. The sprint starts automatically at 3 cards, or tap "start sprint" at any time.
- **← / ✕ Skip:** hides the card until tomorrow. Nothing changes in TickTick.
- **⚡ Claude:** tags the task `claude` in TickTick. For an email, it creates a TickTick Inbox task that links to the email.
- **2m Just start:** starts a 2-minute timer. When it ends, choose *done*, *keep going* (turns it into a sprint) or *stop here*. Stopping still counts, and the card moves to the back of the deck.

Desktop keyboard shortcuts: `←` `→` `d` `2`.

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
| `/api/complete` | POST | `{task_id, method_notes, time_taken_sec}` completes the task in TickTick, or unstars the email |
| `/api/dismiss` | POST | `{task_id, reason: skip\|delegate\|started, note?}` |
| `/api/meta` | POST | `{task_id, effort?, energy?}` stores your tags for a card |
| `/api/priority` | POST | `{task_id, priority: 0\|1\|3\|5}` saves the priority to TickTick. For an email, it creates a TickTick task and unstars the email |
| `/api/someday` | POST | `{task_id}` moves the task to your Someday list (or tags it `someday`) |
| `/api/someday/undo` | POST | Reverses a Someday move |
| `/api/session` | POST | Start or end a sprint |
| `/api/stats` | GET | Counts and recent completions |
| `/api/patterns` | GET | Your "how I did it" notes (the learning data) |
| `/api/delegations` | GET | What you've handed to Claude |

## License

MIT (same as upstream).
