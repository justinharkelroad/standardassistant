import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDB } from '../src/db/client.js';
import { ingestUrl } from '../src/ingest/pipeline.js';

function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article>${body}</article></body></html>`;
}

describe('source relations', () => {
  const originalFetch = global.fetch;
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('cdn.syndication.twimg.com/tweet-result?id=100')) {
        return new Response(
          JSON.stringify({
            id_str: '100',
            text: 'root tweet https://example.com/story',
            created_at: 'Wed Feb 18 12:00:00 +0000 2026',
            user: { screen_name: 'alice', name: 'Alice' },
            favorite_count: 10,
            reply_count: 2,
            retweet_count: 1,
            quote_count: 1,
            in_reply_to_status_id_str: '99',
            quoted_tweet: { id_str: '88' },
            entities: { urls: [{ expanded_url: 'https://example.com/story' }] }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('cdn.syndication.twimg.com/tweet-result?id=99')) {
        return new Response(
          JSON.stringify({ id_str: '99', text: 'parent tweet', user: { screen_name: 'bob' }, entities: { urls: [] } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('cdn.syndication.twimg.com/tweet-result?id=88')) {
        return new Response(
          JSON.stringify({ id_str: '88', text: 'quoted tweet', user: { screen_name: 'charlie' }, entities: { urls: [] } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === 'https://example.com/story') {
        return new Response(html('Story', 'This is linked article content.'), {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores thread, quote, and link relations', async () => {
    const dbPath = path.join(tmpDir, 'kb.sqlite');
    const ctx = initDB(dbPath);

    await ingestUrl(ctx, 'https://x.com/alice/status/100');

    const rels = ctx.db
      .prepare('SELECT relation_type FROM source_relations ORDER BY relation_type')
      .all() as Array<{ relation_type: string }>;

    expect(rels.map((r) => r.relation_type)).toEqual(['links_to', 'quote_of', 'thread_reply']);

    const social = ctx.db
      .prepare("SELECT raw_metadata_json FROM sources WHERE type = 'twitter' ORDER BY id DESC LIMIT 1")
      .get() as { raw_metadata_json: string };

    const metadata = JSON.parse(social.raw_metadata_json || '{}');
    expect(metadata.authorHandle).toBeDefined();
    expect(metadata.engagement).toBeDefined();
  });
});
