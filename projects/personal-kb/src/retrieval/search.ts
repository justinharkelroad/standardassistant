import { DBContext } from '../db/client.js';
import { RetrievedChunk } from '../types.js';
import { cosineSimilarity, embedText } from './embeddings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function recencyBoost(ingestedAt: string, halfLifeDays = 30): number {
  const ageDays = Math.max(0, (Date.now() - new Date(ingestedAt).getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function finalRank(semantic: number, recency: number, sourceWeight: number): number {
  return semantic * 0.65 + recency * 0.2 + sourceWeight * 0.15;
}

export async function searchKB(ctx: DBContext, query: string, limit = 5): Promise<RetrievedChunk[]> {
  const qEmb = await embedText(query);
  const rows = ctx.db
    .prepare(
      `SELECT c.id, c.source_id, c.chunk_index, c.text, c.token_count, c.created_at,
              c.embedding_json, s.url AS source_url, s.title AS source_title,
              s.ingested_at, s.source_weight
       FROM chunks c JOIN sources s ON c.source_id = s.id`
    )
    .all() as Array<any>;

  const scored = rows
    .map((r) => {
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
        source_title: r.source_title
      } satisfies RetrievedChunk;
    })
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, limit);

  return scored;
}

export async function answerQuestion(ctx: DBContext, question: string): Promise<string> {
  const hits = await searchKB(ctx, question, 4);
  if (!hits.length) return 'No knowledge found yet. Ingest something first.';

  const evidence = hits
    .map((h, i) => `[${i + 1}] ${h.text.slice(0, 320)}... (${h.source_url})`)
    .join('\n');

  return `Top matches for: "${question}"\n\n${evidence}`;
}
