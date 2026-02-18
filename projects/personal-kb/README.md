# personal-kb (Phase 2)

Personal knowledge base (RAG-style) with SQLite storage, URL/PDF/YouTube/X/TikTok ingestion, relation graphing, and Discord command handlers.

## What’s implemented

- SQLite schema + migrations for:
  - `sources`, `source_relations`, `chunks`, `entities`, `chunk_entities`, `summaries`, `jobs`
- Ingestion pipeline:
  - Generic article URLs (Readability + JSDOM)
  - PDFs (via `pdf-parse`)
  - YouTube transcripts (via `youtube-transcript`)
  - X/Twitter status extraction with thread/quote traversal (best-effort)
  - TikTok extraction (caption/metadata + transcript/fallback text)
- Relation graph population in `source_relations`:
  - `thread_reply`, `quote_of`, `links_to`
- Link chaining:
  - Outbound links in tweets are auto-ingested and linked as `links_to`
- Better social metadata capture:
  - author handle/name, post timestamp, engagement counts (when available)
- Embeddings + vector retrieval:
  - Preferred: `sqlite-vec` (if `SQLITE_VEC_PATH` points to `vec0` extension)
  - Fallback: embeddings stored as JSON in SQLite + cosine similarity in app
- Configurable ranking controls:
  - Source weight profiles: `balanced`, `research`, `social`
  - Optional JSON overrides for source/type weights and ranking coefficients

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

# Ranking controls
KB_SOURCE_WEIGHT_PROFILE=balanced
KB_SOURCE_WEIGHT_OVERRIDES_JSON={"twitter":0.9,"tiktok":0.8}
KB_RANKING_WEIGHTS_JSON={"semantic":0.65,"recency":0.2,"source":0.15}
KB_RECENCY_HALF_LIFE_DAYS=30

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
npm run dev -- ingest https://x.com/user/status/1234567890
npm run dev -- ingest https://www.tiktok.com/@user/video/1234567890
```

### 2) Ask the KB

```bash
npm run dev -- ask "What are the key points about transformers?"
```

### 3) Discord bot mode

```bash
npm run dev -- discord
```

### 4) Tests

```bash
npm test
```

---

## Notes / known limitations

- Twitter/X traversal is best-effort and relies on publicly reachable syndication data.
  - Deep/full thread expansion depends on what IDs are exposed in the payload.
  - Protected/deleted/age-restricted posts may fail.
- TikTok transcript availability is inconsistent and depends on page payloads.
  - Fallbacks use caption + available page text when transcript data is absent.
- Link chaining currently starts from social posts (especially tweets) and ingests discovered outbound URLs as direct children.
- Ingestion is synchronous; very large relation graphs may take longer to complete.
