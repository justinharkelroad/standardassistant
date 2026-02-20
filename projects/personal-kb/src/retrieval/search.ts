import { DBContext } from '../db/client.js';
import { AskFilters, RetrievedChunk, SourceType } from '../types.js';
import { cosineSimilarity, embedText } from './embeddings.js';
import { finalRank, recencyHalfLifeDays } from './ranking.js';
import { synthesize } from './synthesize.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function recencyBoost(ingestedAt: string, halfLifeDays = recencyHalfLifeDays()): number {
  const ageDays = Math.max(0, (Date.now() - new Date(ingestedAt).getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function normalizeDomain(input: string): string {
  let d = input.toLowerCase().trim();
  // strip protocol
  d = d.replace(/^https?:\/\//, '');
  // strip path/query
  d = d.split('/')[0].split('?')[0].split('#')[0];
  // strip www.
  d = d.replace(/^www\./, '');
  return d;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return normalizeDomain(url);
  }
}

interface SearchOptions {
  limit?: number;
  filters?: AskFilters;
}

export async function searchKB(ctx: DBContext, query: string, limitOrOpts: number | SearchOptions = 5): Promise<{ chunks: RetrievedChunk[]; candidateChunks: number; candidateSources: number }> {
  const opts: SearchOptions = typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts;
  const limit = opts.limit ?? 5;
  const filters = opts.filters;

  const qEmb = await embedText(query);

  // Build query with hard filters
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.collection) {
    conditions.push('s.collection = ?');
    params.push(filters.collection);
  }
  if (filters?.source) {
    conditions.push('s.type = ?');
    params.push(filters.source);
  }
  if (filters?.url) {
    conditions.push('(s.url = ? OR s.canonical_url = ?)');
    params.push(filters.url, filters.url);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = ctx.db
    .prepare(
      `SELECT c.id, c.source_id, c.chunk_index, c.text, c.token_count, c.created_at,
              c.embedding_json, c.section_title, s.url AS source_url, s.title AS source_title,
              s.ingested_at, s.source_weight, s.type AS source_type, s.collection
       FROM chunks c JOIN sources s ON c.source_id = s.id
       ${whereClause}`
    )
    .all(...params) as Array<any>;

  // Apply domain filter in JS (needs URL parsing)
  let filtered = rows;
  if (filters?.domain) {
    const targetDomain = normalizeDomain(filters.domain);
    filtered = rows.filter((r) => extractDomain(r.source_url) === targetDomain);
  }

  const candidateChunks = filtered.length;
  const candidateSources = new Set(filtered.map((r: any) => r.source_id)).size;

  const scored = filtered
    .map((r: any) => {
      const emb = JSON.parse(r.embedding_json || '[]') as number[];
      const semantic = cosineSimilarity(qEmb, emb);
      const recency = recencyBoost(r.ingested_at);
      const sourceWeight = Number(r.source_weight ?? 1);
      const final = finalRank(semantic, recency, sourceWeight);
      return {
        id: r.id,
        source_id: r.source_id,
        chunk_index: r.chunk_index,
        text: r.text,
        token_count: r.token_count,
        created_at: r.created_at,
        semantic_similarity: semantic,
        recency_boost: recency,
        source_weight: sourceWeight,
        final_score: final,
        source_url: r.source_url,
        source_title: r.source_title,
        source_type: r.source_type as SourceType,
        collection: r.collection,
        section_title: r.section_title || null
      } satisfies RetrievedChunk;
    })
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, limit);

  return { chunks: scored, candidateChunks, candidateSources };
}

function formatActiveFilters(filters?: AskFilters): string {
  if (!filters) return 'none';
  const parts: string[] = [];
  if (filters.collection) parts.push(`collection=${filters.collection}`);
  if (filters.domain) parts.push(`domain=${filters.domain}`);
  if (filters.source) parts.push(`source=${filters.source}`);
  if (filters.url) parts.push(`url=${filters.url}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

export async function answerQuestion(ctx: DBContext, question: string, filters?: AskFilters): Promise<string> {
  const { chunks: hits, candidateChunks, candidateSources } = await searchKB(ctx, question, { limit: 6, filters });

  const activeFilters = formatActiveFilters(filters);

  if (!hits.length) {
    const lines = ['No matching knowledge found.'];
    if (filters && Object.keys(filters).length > 0) {
      lines.push(`\nActive filters: ${activeFilters}`);
      lines.push('\nTry broadening your search:');
      lines.push('  npm run dev -- ask "your question"                  # no filters');
      lines.push('  npm run dev -- collections                          # see available collections');
    } else {
      lines.push('Ingest some content first:');
      lines.push('  npm run dev -- ingest <url>');
    }
    return lines.join('\n');
  }

  // Build citation map
  const citationMap = new Map<number, { index: number; title: string; url: string }>();
  let citationIdx = 0;
  for (const hit of hits) {
    if (!citationMap.has(hit.source_id)) {
      citationIdx++;
      citationMap.set(hit.source_id, {
        index: citationIdx,
        title: hit.source_title || 'Untitled',
        url: hit.source_url
      });
    }
  }

  // Synthesize answer
  const { answerLines, lowConfidence } = synthesize(question, hits, citationMap);

  const confidenceNote = lowConfidence
    ? '\n  Note: Confidence is low — results may be loosely related. Try narrower filters or ingest more relevant content.'
    : '';

  // Build citations
  const citations = Array.from(citationMap.values())
    .sort((a, b) => a.index - b.index)
    .map((c) => `  [${c.index}] ${c.title} (${c.url})`)
    .join('\n');

  // Build retrieval context
  const contextLines = [
    `  Filters: ${activeFilters}`,
    `  Candidate chunks: ${candidateChunks}`,
    `  Candidate sources: ${candidateSources}`,
    `  Returned: ${hits.length} chunks`
  ];

  return [
    `Answer:`,
    ...answerLines,
    confidenceNote,
    '',
    `Citations:`,
    citations,
    '',
    `Retrieval context:`,
    ...contextLines
  ].join('\n');
}
