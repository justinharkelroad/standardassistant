import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ingest/extractors.js', () => ({
  extractFromUrl: vi.fn(async () => ({
    source: {
      type: 'article',
      title: 'T',
      text: 'short but non-empty',
      extractionMethod: 'web_fetch',
      extractionConfidence: 0.5
    },
    related: []
  }))
}));

vi.mock('../src/utils/chunking.js', () => ({
  chunkText: vi.fn(() => []),
  chunkBySections: vi.fn(() => []),
  splitTextBySections: vi.fn(() => [{ title: '', body: '' }]),
  simpleTokenCount: vi.fn((txt: string) => txt.trim().split(/\s+/).filter(Boolean).length)
}));

vi.mock('../src/retrieval/embeddings.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3])
}));

describe('ingest pipeline chunk guarantees', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates at least one chunk when extracted text is non-empty but chunker returns none', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/article');

    const chunks = ctx.db.prepare('SELECT text FROM chunks').all() as Array<{ text: string }>;
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe('short but non-empty');
  });

  it('fails ingest explicitly when extracted text is empty/whitespace and no chunks are produced', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'T2',
        text: '   ',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.4
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    await expect(ingestUrl(ctx, 'https://example.com/empty')).rejects.toThrow(/zero chunks/i);

    const job = ctx.db.prepare('SELECT status, error_text FROM jobs ORDER BY id DESC LIMIT 1').get() as { status: string; error_text: string };
    expect(job.status).toBe('failed');
    expect(job.error_text).toContain('zero chunks');
  });

  it('re-ingest without force returns same source ID (dedup)', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    const id1 = await ingestUrl(ctx, 'https://example.com/article');
    const id2 = await ingestUrl(ctx, 'https://example.com/article');
    expect(id2).toBe(id1);
  });

  it('re-ingest with force deletes old chunks and creates new source', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');
    vi.mocked(extractFromUrl).mockResolvedValue({
      source: {
        type: 'article',
        title: 'T',
        text: 'fresh content here',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.5
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    const id1 = await ingestUrl(ctx, 'https://example.com/article');

    const chunksBefore = ctx.db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE source_id = ?').get(id1) as { cnt: number };
    expect(chunksBefore.cnt).toBeGreaterThan(0);

    const id2 = await ingestUrl(ctx, 'https://example.com/article', { force: true });

    // Old source should be deleted, new one created
    expect(id2).not.toBe(id1);

    // Old chunks should be gone
    const oldChunks = ctx.db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE source_id = ?').get(id1) as { cnt: number };
    expect(oldChunks.cnt).toBe(0);

    // New chunks should exist
    const newChunks = ctx.db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE source_id = ?').get(id2) as { cnt: number };
    expect(newChunks.cnt).toBeGreaterThan(0);
  });
});
