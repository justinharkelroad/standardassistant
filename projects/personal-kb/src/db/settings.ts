import { DBContext } from './client.js';
import { DEFAULT_SETTINGS, KBSettings } from '../config.js';

const SETTINGS_KEY = 'kb_settings_v1';

export function getSettings(ctx: DBContext): KBSettings {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<KBSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSettings(ctx: DBContext, patch: Partial<KBSettings>): KBSettings {
  const next = { ...getSettings(ctx), ...patch };
  ctx.db
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
    )
    .run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
