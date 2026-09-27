// Tiny D1 helpers

export async function kvGet(env, key) {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

export async function kvSet(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, JSON.stringify(value)).run();
}

export async function kvDelete(env, key) {
  await env.DB.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
}
