-- Task Tinder (TickTick + Gmail edition) — D1 schema
-- Tasks themselves live in TickTick / Gmail. D1 only keeps what those
-- systems can't: OAuth tokens, your triage decisions, and the
-- "how did you do it?" learning data.

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Effort / energy you set on a card (overrides guesses and TickTick tags)
CREATE TABLE IF NOT EXISTS task_meta (
  task_key TEXT PRIMARY KEY,
  effort TEXT,
  energy TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Skips (hidden until tomorrow), delegations, and 2-minute starts
CREATE TABLE IF NOT EXISTS dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL,
  task_title TEXT,
  reason TEXT NOT NULL,          -- skip | delegate | started
  note TEXT,
  day TEXT NOT NULL,             -- local YYYY-MM-DD
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dismissals_day ON dismissals (day, reason);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget TEXT NOT NULL,
  energy TEXT,
  kind TEXT DEFAULT 'sprint',    -- sprint | two_minute
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  tasks_completed INTEGER DEFAULT 0,
  tasks_skipped INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT,
  task_title TEXT,
  source TEXT,
  project TEXT,
  quadrant TEXT,
  effort TEXT,
  energy TEXT,
  method_notes TEXT,
  time_taken_sec INTEGER,
  session_id INTEGER,
  completed_at TEXT DEFAULT (datetime('now'))
);
