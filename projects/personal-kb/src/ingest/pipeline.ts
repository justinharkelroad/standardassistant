import { DBContext } from '../db/client.js';
import { chunkText, simpleTokenCount } from '../utils/chunking.js';
import { embedText } from '../retrieval/embeddings.js';
import { extractFromUrl, RelationType } from './extractors.js';
import { sourceWeightFor } from '../retrieval/ranking.js';
import { getSettings } from '../db/settings.js';
import { logIngestEvent, recordJobMetric } from '../observability.js';
import { buildIngestionSummary } from './summary.js';

interface IngestOptions {
  visited?: Set<string>;
  parentSourceId?: number;
  relationType?: RelationType;
  jobId?: number;
  onIngested?: (event: { sourceId: number; url: string; summary: string }) => Promise<void>;
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

  const settings = getSettings(ctx);
  const extractionStartedAt = Date.now();
  const extractedBundle = await extractFromUrl(canonicalUrl, {
    browserRelayFallbackEnabled: settings.browserRelayFallbackEnabled
  });
  recordJobMetric(ctx, {
    jobId: options.jobId,
    metricName: 'extract_ms',
    metricValue: Date.now() - extractionStartedAt,
    labels: { method: extractedBundle.source.extractionMethod }
  });

  const extracted = extractedBundle.source;
  const sourceWeight = sourceWeightFor(extracted.type);

  const src = db
    .prepare(
      `INSERT INTO sources (type, url, canonical_url, title, author, published_at, raw_metadata_json, source_weight, extraction_method, extraction_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      extracted.type,
      canonicalUrl,
      canonicalUrl,
      extracted.title || null,
      extracted.author || null,
      extracted.publishedAt || null,
      JSON.stringify(extracted.metadata || {}),
      sourceWeight,
      extracted.extractionMethod,
      extracted.extractionConfidence
    );

  const sourceId = Number(src.lastInsertRowid);

  logIngestEvent(ctx, {
    jobId: options.jobId,
    sourceId,
    sourceUrl: canonicalUrl,
    eventType: 'source_ingested',
    event: {
      extractionMethod: extracted.extractionMethod,
      extractionConfidence: extracted.extractionConfidence,
      type: extracted.type
    }
  });

  if (options.parentSourceId && options.relationType) {
    linkRelation(ctx, options.parentSourceId, sourceId, options.relationType);
  }

  const extractedText = extracted.text || '';
  let chunks = chunkText(extractedText);
  if (chunks.length === 0) {
    const trimmed = extractedText.trim();
    if (trimmed.length > 0) {
      chunks = [trimmed];
    } else {
      throw new Error('Extraction produced empty text; refusing to complete ingest with zero chunks.');
    }
  }

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

  recordJobMetric(ctx, {
    jobId: options.jobId,
    metricName: 'chunks_created',
    metricValue: chunks.length,
    labels: { sourceId }
  });

  if (options.onIngested) {
    await options.onIngested({
      sourceId,
      url: canonicalUrl,
      summary: buildIngestionSummary(canonicalUrl, sourceId, extracted, chunks.length)
    });
  }

  for (const rel of extractedBundle.related) {
    await ingestSingle(ctx, rel.url, {
      visited,
      parentSourceId: sourceId,
      relationType: rel.relationType,
      jobId: options.jobId,
      onIngested: options.onIngested
    });
  }

  return sourceId;
}

export async function ingestUrl(
  ctx: DBContext,
  url: string,
  options?: { onIngested?: (event: { sourceId: number; url: string; summary: string }) => Promise<void> }
): Promise<number> {
  const { db } = ctx;

  const job = db
    .prepare('INSERT INTO jobs (job_type, status, payload_json) VALUES (?, ?, ?)')
    .run('ingest', 'running', JSON.stringify({ url }));

  const jobId = Number(job.lastInsertRowid);
  const started = Date.now();

  try {
    logIngestEvent(ctx, { jobId, sourceUrl: url, eventType: 'job_started', event: { url } });
    const sourceId = await ingestSingle(ctx, url, { visited: new Set<string>(), jobId, onIngested: options?.onIngested });
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('done', jobId);
    recordJobMetric(ctx, { jobId, metricName: 'job_duration_ms', metricValue: Date.now() - started });
    logIngestEvent(ctx, { jobId, sourceId, sourceUrl: url, eventType: 'job_completed' });
    return sourceId;
  } catch (error) {
    db.prepare('UPDATE jobs SET status = ?, error_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'failed',
      error instanceof Error ? error.message : String(error),
      jobId
    );
    logIngestEvent(ctx, {
      jobId,
      sourceUrl: url,
      level: 'error',
      eventType: 'job_failed',
      event: { message: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}
