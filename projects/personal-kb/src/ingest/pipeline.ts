import { DBContext } from '../db/client.js';
import { chunkText, simpleTokenCount } from '../utils/chunking.js';
import { embedText } from '../retrieval/embeddings.js';
import { extractFromUrl, RelationType } from './extractors.js';
import { sourceWeightFor } from '../retrieval/ranking.js';

interface IngestOptions {
  visited?: Set<string>;
  parentSourceId?: number;
  relationType?: RelationType;
}

function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function linkRelation(ctx: DBContext, parentId: number, childId: number, relationType: RelationType): void {
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO source_relations (parent_source_id, child_source_id, relation_type)
       VALUES (?, ?, ?)`
    )
    .run(parentId, childId, relationType);
}

async function ingestSingle(ctx: DBContext, url: string, options: IngestOptions): Promise<number> {
  const { db, sqliteVecEnabled } = ctx;
  const canonicalUrl = canonicalizeUrl(url);
  const visited = options.visited || new Set<string>();

  if (visited.has(canonicalUrl)) {
    const existing = db
      .prepare('SELECT id FROM sources WHERE canonical_url = ? OR url = ? ORDER BY id DESC LIMIT 1')
      .get(canonicalUrl, canonicalUrl) as { id: number } | undefined;
    if (existing && options.parentSourceId && options.relationType) {
      linkRelation(ctx, options.parentSourceId, existing.id, options.relationType);
    }
    return existing?.id || 0;
  }
  visited.add(canonicalUrl);

  const existing = db
    .prepare('SELECT id FROM sources WHERE canonical_url = ? OR url = ? ORDER BY id DESC LIMIT 1')
    .get(canonicalUrl, canonicalUrl) as { id: number } | undefined;
  if (existing) {
    if (options.parentSourceId && options.relationType) {
      linkRelation(ctx, options.parentSourceId, existing.id, options.relationType);
    }
    return existing.id;
  }

  const extractedBundle = await extractFromUrl(canonicalUrl);
  const extracted = extractedBundle.source;
  const sourceWeight = sourceWeightFor(extracted.type);

  const src = db
    .prepare(
      `INSERT INTO sources (type, url, canonical_url, title, author, published_at, raw_metadata_json, source_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      extracted.type,
      canonicalUrl,
      canonicalUrl,
      extracted.title || null,
      extracted.author || null,
      extracted.publishedAt || null,
      JSON.stringify(extracted.metadata || {}),
      sourceWeight
    );

  const sourceId = Number(src.lastInsertRowid);

  if (options.parentSourceId && options.relationType) {
    linkRelation(ctx, options.parentSourceId, sourceId, options.relationType);
  }

  const chunks = chunkText(extracted.text || '');

  const insertChunk = db.prepare(
    'INSERT INTO chunks (source_id, chunk_index, text, token_count, embedding_json) VALUES (?, ?, ?, ?, ?)'
  );

  const insertVec = sqliteVecEnabled
    ? db.prepare('INSERT OR REPLACE INTO chunk_vec (chunk_id, embedding) VALUES (?, ?)')
    : null;

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const emb = await embedText(text);
    const result = insertChunk.run(sourceId, i, text, simpleTokenCount(text), JSON.stringify(emb));
    if (sqliteVecEnabled) {
      try {
        insertVec?.run(Number(result.lastInsertRowid), JSON.stringify(emb));
      } catch {
        // silently fallback to json-vector mode
      }
    }
  }

  for (const rel of extractedBundle.related) {
    await ingestSingle(ctx, rel.url, {
      visited,
      parentSourceId: sourceId,
      relationType: rel.relationType
    });
  }

  return sourceId;
}

export async function ingestUrl(ctx: DBContext, url: string): Promise<number> {
  const { db } = ctx;

  const job = db
    .prepare('INSERT INTO jobs (job_type, status, payload_json) VALUES (?, ?, ?)')
    .run('ingest', 'running', JSON.stringify({ url }));

  try {
    const sourceId = await ingestSingle(ctx, url, { visited: new Set<string>() });
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('done', job.lastInsertRowid);
    return sourceId;
  } catch (error) {
    db.prepare('UPDATE jobs SET status = ?, error_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'failed',
      error instanceof Error ? error.message : String(error),
      job.lastInsertRowid
    );
    throw error;
  }
}
