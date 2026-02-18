# personal-kb (Phase 1 MVP)

Personal knowledge base (RAG-style) with SQLite storage, URL/PDF/YouTube ingestion, and Discord command handlers.

## What’s implemented

- SQLite schema + migrations for:
  - `sources`, `source_relations`, `chunks`, `entities`, `chunk_entities`, `summaries`, `jobs`
- Ingestion pipeline:
  - Generic article URLs (Readability + JSDOM)
  - PDFs (via `pdf-parse`)
  - YouTube transcripts (via `youtube-transcript`)
- Embeddings + vector retrieval:
  - Preferred: `sqlite-vec` (if `SQLITE_VEC_PATH` points to `vec0` extension)
  - Fallback: embeddings stored as JSON in SQLite + cosine similarity in app
  - Embeddings provider:
    - OpenAI if `OPENAI_API_KEY` exists
    - Deterministic local hash embedding fallback (no key needed)
- Retrieval ranking with weighted formula:
  - `semantic_similarity * 0.65 + recency_boost * 0.20 + source_weight * 0.15`
- Discord handlers:
  - Slash commands: `/ingest`, `/askkb`
  - Message commands: `!ingest <url>`, `!askkb <question>`
- Basic tests:
  - Chunking behavior
  - Ranking formula + recency decay

---

## Setup

```bash
cd projects/personal-kb
npm install
```

Create `.env` (optional values shown):

```bash
KB_DB_PATH=./data/kb.sqlite
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMS=384

# Optional sqlite-vec dynamic extension path
SQLITE_VEC_PATH=/opt/homebrew/lib/vec0.dylib

# Discord (for bot mode)
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

## Run

### 1) Ingest a source

```bash
npm run dev -- ingest https://example.com/article
npm run dev -- ingest https://arxiv.org/pdf/1706.03762.pdf
npm run dev -- ingest https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### 2) Ask the KB

```bash
npm run dev -- ask "What are the key points about transformers?"
```

### 3) Discord bot mode

```bash
npm run dev -- discord
```

This registers guild slash commands and starts bot listeners.

### 4) Tests

```bash
npm test
```

---

## Known gaps / next for Phase 2 (X/Twitter + TikTok)

### X/Twitter thread support
- Add resolver for status URL → thread expansion (replies/quotes)
- Preserve relation graph via `source_relations` (`thread_reply`, `quote_of`, `links_to`)
- Link-chaining: parse outbound URLs from tweets and enqueue linked article ingestion
- Better metadata quality (author handle, post timestamp, engagement)

### TikTok support
- Add extractor for caption/transcript/description/music metadata
- Handle alternate URL forms + short-links and redirects
- Robust transcript fallback strategy when subtitles are unavailable
- Improve source weighting profile for short-form content reliability

---

## Implementation notes

- MVP is intentionally lightweight and synchronous for local operation.
- `jobs` table is included and used for ingestion state tracking (`running/done/failed`).
- Entity/relation extraction tables exist in schema; extraction logic can be layered in Phase 2.
