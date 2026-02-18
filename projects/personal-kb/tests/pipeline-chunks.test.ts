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
});
