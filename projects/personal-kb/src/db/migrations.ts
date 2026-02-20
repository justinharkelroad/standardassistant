import Database from 'better-sqlite3';

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT,
      title TEXT,
      author TEXT,
      published_at TEXT,
      ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      raw_metadata_json TEXT,
      source_weight REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS source_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_source_id INTEGER NOT NULL,
      child_source_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      FOREIGN KEY(parent_source_id) REFERENCES sources(id),
      FOREIGN KEY(child_source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS chunk_entities (
      chunk_id INTEGER NOT NULL,
      entity_id INTEGER NOT NULL,
      confidence REAL NOT NULL,
      PRIMARY KEY (chunk_id, entity_id),
      FOREIGN KEY(chunk_id) REFERENCES chunks(id),
      FOREIGN KEY(entity_id) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      summary_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingest_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      source_url TEXT,
      source_id INTEGER,
      level TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id),
      FOREIGN KEY(source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS job_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      labels_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
    CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_rel_unique ON source_relations(parent_source_id, child_source_id, relation_type);
    CREATE INDEX IF NOT EXISTS idx_ingest_logs_job_id ON ingest_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_metrics_job_id ON job_metrics(job_id);
  `);

  ensureColumn(db, 'sources', 'extraction_method', 'TEXT');
  ensureColumn(db, 'sources', 'extraction_confidence', 'REAL');

  // Section-aware chunking: section_title on chunks
  ensureColumn(db, 'chunks', 'section_title', 'TEXT');

  // Phase 4: collection support
  ensureColumn(db, 'sources', 'collection', "TEXT NOT NULL DEFAULT 'default'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sources_collection ON sources(collection);
    CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
    CREATE INDEX IF NOT EXISTS idx_sources_canonical_url ON sources(canonical_url);
  `);

  try {
    db.pragma('journal_mode = WAL');
  } catch {
    // Ignore for unsupported environments.
  }
}
