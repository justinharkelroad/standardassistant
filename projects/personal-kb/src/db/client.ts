import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations.js';

export interface DBContext {
  db: Database.Database;
  sqliteVecEnabled: boolean;
}

function maybeEnableSqliteVec(db: Database.Database): boolean {
  const candidatePaths = [
    process.env.SQLITE_VEC_PATH,
    '/usr/local/lib/vec0.dylib',
    '/opt/homebrew/lib/vec0.dylib'
  ].filter(Boolean) as string[];

  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    try {
      db.loadExtension(candidate);
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
          chunk_id INTEGER PRIMARY KEY,
          embedding FLOAT[384]
        );
      `);
      return true;
    } catch {
      // keep trying fallback options
    }
  }

  return false;
}

export function initDB(dbPath = path.resolve(process.cwd(), 'data', 'kb.sqlite')): DBContext {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db);
  const sqliteVecEnabled = maybeEnableSqliteVec(db);
  return { db, sqliteVecEnabled };
}
