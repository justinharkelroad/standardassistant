export type SourceType = 'article' | 'pdf' | 'youtube' | 'twitter' | 'tiktok' | 'unknown';

export interface SourceRecord {
  id: number;
  type: SourceType;
  url: string;
  canonical_url?: string | null;
  title?: string | null;
  author?: string | null;
  published_at?: string | null;
  ingested_at: string;
  raw_metadata_json?: string | null;
  source_weight?: number;
}

export interface ChunkRecord {
  id: number;
  source_id: number;
  chunk_index: number;
  text: string;
  token_count: number;
  created_at: string;
}

export interface RetrievedChunk extends ChunkRecord {
  semantic_similarity: number;
  recency_boost: number;
  source_weight: number;
  final_score: number;
  source_url: string;
  source_title: string | null;
}
