# Personal Knowledge Base (RAG) Plan

## Goal
Build a personal knowledge base you can continuously grow from Discord by dropping links/files.

## Sources to Ingest
- Web articles (general URLs)
- YouTube (transcript + metadata)
- X/Twitter posts + full thread expansion
- TikTok (caption/transcript/metadata where available)
- PDFs (uploaded or linked)
- Link-chaining behavior:
  - If a tweet links an article, ingest both tweet/thread and linked page.

## Core Features
1. Discord-first ingestion
   - You drop a URL/file in Discord.
   - Bot ingests asynchronously and reacts/status-updates.
2. Normalization pipeline
   - Fetch/extract source text
   - Clean/chunk content
   - Extract entities (people, companies, concepts)
   - Embed chunks
   - Store docs/chunks/entities/edges in SQLite
3. Retrieval & QA
   - Natural language query endpoint/command
   - Semantic vector search + metadata filters
   - Time-aware ranking boost for recency
   - Source-weighted ranking (trust tiers per source type/domain)
4. Paywalled extraction
   - Fallback to browser automation through attached Chrome session for logged-in sites.
5. Optional channel publishing
   - Post summary cards to a chosen Discord channel after ingestion.

## Proposed Stack
- Runtime: Python (FastAPI worker) or Node (TypeScript)
- DB: SQLite + sqlite-vec (or fallback vector table strategy)
- Embeddings: configurable provider (OpenAI/Ollama)
- NLP/entity extraction: LLM-assisted extraction with deterministic schema
- Queue: lightweight local queue (SQLite job table)

## Data Model (SQLite)
- sources
  - id, type, url, canonical_url, title, author, published_at, ingested_at, raw_metadata_json
- source_relations
  - id, parent_source_id, child_source_id, relation_type (thread_reply, links_to, quote_of)
- chunks
  - id, source_id, chunk_index, text, token_count, embedding (vector), created_at
- entities
  - id, name, type (person/company/concept), normalized_name
- chunk_entities
  - chunk_id, entity_id, confidence
- summaries
  - id, source_id, summary_text, created_at

## Ranking Strategy
Final score =
- semantic_similarity * 0.65
- recency_boost * 0.20
- source_weight * 0.15

Where:
- recency_boost decays by age (e.g., half-life 30 days)
- source_weight is configurable per source type/domain

## Discord UX
Commands (initial):
- `/ingest <url>` (or auto-ingest URL messages in selected channels)
- `/askkb <question>`
- `/kb-status <url|id>`
- `/kb-config` (toggle auto-ingest, summary channel)

Bot behavior:
- Adds 👀 when queued
- Adds ✅ on success
- Adds ⚠️ with short reason on failure

## Paywalled Fallback Flow
1. Try standard fetch/extraction first.
2. If blocked/insufficient text, trigger browser relay job.
3. Use attached Chrome tab session to load page and extract readable content.
4. Store provenance: extracted_via = "browser_relay".

## Implementation Phases
### Phase 1 (MVP)
- Discord URL ingestion (articles + PDFs + YouTube transcript)
- SQLite schema + embeddings + semantic search
- `/askkb` question answering with citations

### Phase 2
- X/Twitter full-thread + linked-article chaining
- TikTok ingestion improvements
- Entity graph + better ranking controls

### Phase 3
- Paywalled browser-relay extraction
- Cross-post summaries to configurable Discord channel
- Admin/config commands and observability

## Open Questions
- Preferred embeddings provider by default (OpenAI vs Ollama)?
- Auto-ingest all URLs in one channel, or only explicit `/ingest`?
- Should summaries post publicly by default, or only on-demand?

## Next Step
Scaffold project in `workspace/projects/personal-kb/` with:
- ingestion workers
- SQLite schema/migrations
- Discord command handlers
- retrieval pipeline + ranking
