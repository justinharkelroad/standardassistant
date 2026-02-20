import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ingest/extractors.js', () => ({
  extractFromUrl: vi.fn(async (_url: string) => ({
    source: {
      type: 'article',
      title: 'Test Article',
      text: 'This is test content about offers and pricing strategies for businesses.',
      extractionMethod: 'web_fetch',
      extractionConfidence: 0.88
    },
    related: []
  }))
}));

vi.mock('../src/retrieval/embeddings.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
  cosineSimilarity: vi.fn(() => 0.85)
}));

describe('collections and filters', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('ingest defaults to "default" collection when none specified', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/article1');

    const source = ctx.db.prepare('SELECT collection FROM sources WHERE url LIKE ?').get('%example.com%') as { collection: string };
    expect(source.collection).toBe('default');
  });

  it('ingest persists collection when specified', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/article2', { collection: 'mybooks' });

    const source = ctx.db.prepare('SELECT collection FROM sources WHERE url LIKE ?').get('%example.com%') as { collection: string };
    expect(source.collection).toBe('mybooks');
  });

  it('ask with --collection excludes other collections', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { searchKB } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://a.com/1', { collection: 'alpha' });
    await ingestUrl(ctx, 'https://b.com/2', { collection: 'beta' });

    const alphaResults = await searchKB(ctx, 'test', { filters: { collection: 'alpha' } });
    const betaResults = await searchKB(ctx, 'test', { filters: { collection: 'beta' } });

    // Each should only contain chunks from its own collection
    for (const chunk of alphaResults.chunks) {
      expect(chunk.collection).toBe('alpha');
    }
    for (const chunk of betaResults.chunks) {
      expect(chunk.collection).toBe('beta');
    }
    expect(alphaResults.candidateSources).toBe(1);
    expect(betaResults.candidateSources).toBe(1);
  });

  it('ask with --domain only returns that domain', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    // First source: standardplaybook.com
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Playbook Article',
        text: 'Content from standardplaybook about offers and growth.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    // Second source: other.com
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Other Article',
        text: 'Content from another site about different topics.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { searchKB } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://standardplaybook.com/article');
    await ingestUrl(ctx, 'https://other.com/article');

    const results = await searchKB(ctx, 'test', { filters: { domain: 'standardplaybook.com' } });

    for (const chunk of results.chunks) {
      expect(chunk.source_url).toContain('standardplaybook.com');
    }
    expect(results.candidateSources).toBe(1);
  });

  it('combined filters (collection + domain + source) narrow results', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    // PDF source
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'pdf',
        title: 'PDF Doc',
        text: 'A PDF document with important data.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.95
      },
      related: []
    });

    // Article source (same domain, same collection)
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Article',
        text: 'An article about the same topic.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    // Article source (different collection)
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Other Collection Article',
        text: 'An article in a different collection.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { searchKB } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://site.com/doc.pdf', { collection: 'research' });
    await ingestUrl(ctx, 'https://site.com/article', { collection: 'research' });
    await ingestUrl(ctx, 'https://site.com/other', { collection: 'other' });

    // Filter to: collection=research, domain=site.com, source=article
    const results = await searchKB(ctx, 'test', {
      filters: { collection: 'research', domain: 'site.com', source: 'article' }
    });

    expect(results.candidateSources).toBe(1);
    for (const chunk of results.chunks) {
      expect(chunk.collection).toBe('research');
      expect(chunk.source_type).toBe('article');
      expect(chunk.source_url).toContain('site.com');
    }
  });

  it('plain ask (no filters) still works — backward compatibility', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/compat-test');

    const answer = await answerQuestion(ctx, 'test question');
    expect(answer).toContain('Answer:');
    expect(answer).toContain('Citations:');
    expect(answer).toContain('Retrieval context:');
    expect(answer).toContain('Filters: none');
  });

  it('plain ingest (no collection) defaults to "default" — backward compatibility', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    const sourceId = await ingestUrl(ctx, 'https://example.com/bc-test');
    expect(sourceId).toBeGreaterThan(0);

    const source = ctx.db.prepare('SELECT collection FROM sources WHERE id = ?').get(sourceId) as { collection: string };
    expect(source.collection).toBe('default');
  });

  it('answerQuestion shows helpful message when filters yield no results', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/only-default');

    const answer = await answerQuestion(ctx, 'test question', { collection: 'nonexistent' });
    expect(answer).toContain('No matching knowledge found');
    expect(answer).toContain('collection=nonexistent');
    expect(answer).toContain('broadening your search');
  });

  it('searchKB returns source_type and collection on chunks', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { searchKB } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/typed', { collection: 'test-col' });

    const results = await searchKB(ctx, 'test', { limit: 1 });
    expect(results.chunks[0].source_type).toBe('article');
    expect(results.chunks[0].collection).toBe('test-col');
  });

  it('collections table aggregation works', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: { type: 'article', title: 'A', text: 'Content A.', extractionMethod: 'web_fetch', extractionConfidence: 0.88 },
      related: []
    });
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: { type: 'pdf', title: 'B', text: 'Content B.', extractionMethod: 'web_fetch', extractionConfidence: 0.95 },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://a.com/1', { collection: 'col1' });
    await ingestUrl(ctx, 'https://b.com/2', { collection: 'col1' });

    const rows = ctx.db
      .prepare(
        `SELECT s.collection,
                COUNT(DISTINCT s.id) AS source_count,
                COUNT(c.id) AS chunk_count
         FROM sources s
         LEFT JOIN chunks c ON c.source_id = s.id
         GROUP BY s.collection`
      )
      .all() as Array<{ collection: string; source_count: number; chunk_count: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].collection).toBe('col1');
    expect(rows[0].source_count).toBe(2);
    expect(rows[0].chunk_count).toBeGreaterThanOrEqual(2);
  });
});
