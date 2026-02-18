# personal-kb (Phase 3)

Personal knowledge base (RAG-style) with SQLite storage, URL/PDF/YouTube/X/TikTok ingestion, relation graphing, Discord command handlers, extraction provenance, and observability.

## What’s implemented

### Existing (Phases 1-2 preserved)

- SQLite schema + migrations for sources/chunks/entities/summaries/jobs/relation graph
- Ingestion pipeline:
  - Generic article URLs (Readability + JSDOM)
  - PDFs (`pdf-parse`)
  - YouTube transcripts (`youtube-transcript`)
  - X/Twitter status extraction + thread/quote traversal
  - TikTok extraction (caption/metadata + transcript/fallback text)
- Relation graph population (`thread_reply`, `quote_of`, `links_to`)
- Embeddings + vector retrieval (`sqlite-vec` optional fallback to JSON cosine)
- Configurable ranking controls

### New (Phase 3)

1. **Config-gated browser relay fallback for paywalled/insufficient article extraction**
   - Primary extraction uses normal web fetch + Readability.
   - Fallback can invoke a browser-relay extractor command (intended for OpenClaw Chrome relay session) when blocked or low readable text.
2. **Extraction provenance + confidence tracking**
   - `sources.extraction_method` (e.g. `web_fetch`, `browser_relay`, `api`)
   - `sources.extraction_confidence` (0-1 heuristic)
3. **Optional auto-posting ingestion summaries to Discord**
   - Per-ingest summary text includes type/method/confidence/chunk count/preview.
4. **Admin/config controls**
   - Discord text commands:
     - `!kb settings`
     - `!kb summary on`
     - `!kb summary off`
     - `!kb summary channel <#channelId|channelId>`
   - Slash command: `/kbconfig` with actions (`show`, `autosummary-on`, `autosummary-off`, `set-summary-channel`)
   - CLI config/status:
     - `npm run dev -- status`
     - `npm run dev -- config set <key> <value>`
5. **Observability**
   - Structured ingest logs table: `ingest_logs`
   - Job metrics table: `job_metrics`
   - Health/status output via CLI `status` command
6. **Tests**
   - Fallback routing behavior
   - Summary posting config command behavior

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

# Phase 3 settings defaults
KB_AUTO_SUMMARY_POST_ENABLED=false
KB_SUMMARY_CHANNEL_ID=
KB_BROWSER_RELAY_FALLBACK_ENABLED=false
KB_MIN_READABLE_CHARS=300

# Browser relay extractor command (required only if fallback is enabled)
# Command should return JSON on stdout: {"title":"...","text":"...","metadata":{},"confidence":0.75}
KB_BROWSER_RELAY_EXTRACT_CMD=/absolute/path/to/extract-via-relay
KB_BROWSER_RELAY_TIMEOUT_MS=45000
```

---

## Run

### Ingest / Ask

```bash
npm run dev -- ingest https://example.com/article
npm run dev -- ask "What are the key points about transformers?"
```

### Discord bot

```bash
npm run dev -- discord
```

### Status / Config

```bash
npm run dev -- status
npm run dev -- config set autoSummaryPostEnabled true
npm run dev -- config set summaryChannelId 123456789012345678
npm run dev -- config set browserRelayFallbackEnabled true
```

### Tests

```bash
npm test
```

---

## Browser relay runbook (concise)

1. Enable fallback:
   - `npm run dev -- config set browserRelayFallbackEnabled true`
2. Provide `KB_BROWSER_RELAY_EXTRACT_CMD` in `.env`
3. Ensure that command can access an attached OpenClaw Chrome relay tab/session and emits JSON with extracted text.
4. Run ingestion normally; pipeline will fallback when blocked or when extracted readable text is too short.

---

## Known limitations + security notes

- Browser relay fallback is **disabled by default** and only runs when explicitly enabled.
- This repo calls a configured external command for relay extraction, so security depends on:
  - command path integrity,
  - output validation,
  - relay session access controls.
- If relay session is not attached/authenticated, fallback may fail.
- Confidence scores are heuristic (not model-calibrated).
- Auto-summary posts may expose URL/title/preview in Discord; use private channels where appropriate.
- Ingestion pipeline remains synchronous and can be slow for deep relation graphs.
