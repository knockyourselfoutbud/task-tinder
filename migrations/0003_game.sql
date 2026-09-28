-- Focus card + game layer
ALTER TABLE task_meta ADD COLUMN first_move TEXT;
ALTER TABLE completions ADD COLUMN xp INTEGER DEFAULT 0;
ALTER TABLE completions ADD COLUMN combo INTEGER DEFAULT 1;
ALTER TABLE completions ADD COLUMN beat_clock INTEGER DEFAULT 0;
ALTER TABLE completions ADD COLUMN day TEXT;
