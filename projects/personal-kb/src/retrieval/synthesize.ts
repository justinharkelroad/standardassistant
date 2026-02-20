import { RetrievedChunk } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Noise patterns                                                    */
/* ------------------------------------------------------------------ */

const NOISE_LINE_PATTERNS: RegExp[] = [
  /^(menu|navigation|skip to|jump to|breadcrumb|sidebar|footer|copyright|©)/i,
  /^(home|about|contact|login|sign ?up|subscribe|follow us|share this)/i,
  /^(cookie|privacy|terms of service|all rights reserved)/i,
  /^(previous|next|back to top|read more|click here|learn more)$/i,
  /^\s*[|•·–—]\s*$/,
  /^(.)\1{4,}$/,                       // repeated chars: ===== or -----
  /^\s*\d+\s*$/,                       // bare numbers (page numbers)
  /^(loading|please wait|javascript)/i,
];

const NOISE_SECTION_TITLES: RegExp[] = [
  /^(nav|navigation|menu|header|footer|sidebar|cookie|banner)$/i,
  /^(hero|carousel|slider|featured|testimonial)s?$/i,
  /^(sign.?up|login|subscribe|newsletter|social)$/i,
];

const MAX_BULLET_LEN = 160;
const MAX_BULLETS = 6;
const MIN_BULLETS = 2;

/* ------------------------------------------------------------------ */
/*  Intent detection                                                   */
/* ------------------------------------------------------------------ */

const OFFER_KEYWORDS = /\b(offer|pricing|price|plans?|packages?|tiers?|bundle|subscription|cost|rate)\b/i;
const OFFER_COMPOUND = /\b(offer|pricing|price)\b.*\bstructure\b|\bstructure\b.*\b(offer|pricing|price)\b/i;
const CTA_KEYWORDS = /\b(cta|call.to.action|sign.?up|book|schedule|apply|enroll|start|get.started|buy|purchase)\b/i;
const POSITIONING_KEYWORDS = /\b(position|differentiator|unique|value.prop|tagline|mission|promise|brand)\b/i;

export type AnswerIntent = 'offer_structure' | 'general';

export function detectIntent(question: string): AnswerIntent {
  if (OFFER_KEYWORDS.test(question) || OFFER_COMPOUND.test(question)) return 'offer_structure';
  return 'general';
}

/* ------------------------------------------------------------------ */
/*  Section-aware noise filtering                                      */
/* ------------------------------------------------------------------ */

function isSectionNoisy(sectionTitle: string | null): boolean {
  if (!sectionTitle) return false;
  return NOISE_SECTION_TITLES.some((p) => p.test(sectionTitle));
}

export function filterNoisyChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks.filter((c) => !isSectionNoisy(c.section_title));
}

/* ------------------------------------------------------------------ */
/*  Text cleaning                                                      */
/* ------------------------------------------------------------------ */

export function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 5) return true;
  // Long lines are content even if they start with a noise prefix
  if (trimmed.length > 80) return false;
  return NOISE_LINE_PATTERNS.some((p) => p.test(trimmed));
}

export function cleanChunkText(text: string): string {
  return text
    .split('\n')
    .map(cleanLine)
    .filter((l) => !isNoiseLine(l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Sentence splitting                                                 */
/* ------------------------------------------------------------------ */

const ABBREV = /(?:Mr|Mrs|Ms|Dr|Jr|Sr|Inc|Ltd|Co|vs|etc|e\.g|i\.e|approx|dept|est|govt)\.$/i;

export function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  const merged: string[] = [];

  for (const seg of raw) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    if (merged.length > 0 && ABBREV.test(merged[merged.length - 1])) {
      merged[merged.length - 1] += ' ' + trimmed;
    } else {
      merged.push(trimmed);
    }
  }
  return merged.filter((s) => s.length >= 10);
}

/* ------------------------------------------------------------------ */
/*  Deduplication                                                      */
/* ------------------------------------------------------------------ */

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function deduplicateSpans(spans: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const span of spans) {
    const key = normalizeForDedup(span);
    let isDup = seen.has(key);
    if (!isDup) {
      for (const prev of seen) {
        if (prev.includes(key) || key.includes(prev)) {
          isDup = true;
          break;
        }
      }
    }
    if (!isDup) {
      seen.add(key);
      result.push(span);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Span extraction from scored chunks                                 */
/* ------------------------------------------------------------------ */

interface ScoredSpan {
  text: string;
  sourceId: number;
  score: number;
}

function queryTerms(question: string): string[] {
  const stops = new Set(['what', 'is', 'the', 'our', 'a', 'an', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'how', 'do', 'does', 'are', 'we', 'my', 'their', 'its', 'this', 'that']);
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stops.has(w));
}

function spanRelevance(span: string, terms: string[]): number {
  const lower = span.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (lower.includes(t)) hits++;
  }
  return terms.length > 0 ? hits / terms.length : 0;
}

export function extractKeySpans(chunks: RetrievedChunk[], question: string, maxSpans: number = MAX_BULLETS): ScoredSpan[] {
  const terms = queryTerms(question);
  const allSpans: ScoredSpan[] = [];

  for (const chunk of chunks) {
    const cleaned = cleanChunkText(chunk.text);
    const sentences = splitSentences(cleaned);

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const relevance = spanRelevance(s, terms);
      const positionBoost = 1 - (i / Math.max(sentences.length, 1)) * 0.3;
      const lengthPenalty = s.length > 200 ? 0.8 : 1;

      allSpans.push({
        text: s,
        sourceId: chunk.source_id,
        score: (chunk.final_score * 0.5 + relevance * 0.5) * positionBoost * lengthPenalty
      });
    }
  }

  allSpans.sort((a, b) => b.score - a.score);

  const texts = deduplicateSpans(allSpans.map((s) => s.text));
  const result: ScoredSpan[] = [];
  for (const text of texts) {
    if (result.length >= maxSpans) break;
    const original = allSpans.find((s) => s.text === text);
    if (original) result.push(original);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Bullet formatting                                                  */
/* ------------------------------------------------------------------ */

export function truncateBullet(text: string, maxLen: number = MAX_BULLET_LEN): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut) + '...';
}

/* ------------------------------------------------------------------ */
/*  Structured offer extraction                                        */
/* ------------------------------------------------------------------ */

export interface StructuredOffer {
  offer_name: string;
  best_for: string | null;
  price: string | null;
  cta_text: string | null;
}

/* ---------- Canonical offer whitelist ---------- */

interface CanonicalEntry { canonical: string; aliases: string[] }

const CANONICAL_OFFERS: CanonicalEntry[] = [
  { canonical: 'The Boardroom', aliases: ['the boardroom', 'boardroom'] },
  { canonical: '8 Week Experience', aliases: ['8 week experience', '8-week experience', '8week experience'] },
  { canonical: 'The Directive', aliases: ['the directive', 'directive'] },
  { canonical: '6 Week Producer Challenge', aliases: ['6 week producer challenge', '6-week producer challenge', 'producer challenge'] },
];

export function matchCanonicalOffer(text: string): string | null {
  const lower = text.toLowerCase();
  for (const entry of CANONICAL_OFFERS) {
    for (const alias of entry.aliases) {
      if (lower.includes(alias)) return entry.canonical;
    }
  }
  return null;
}

/* ---------- Strict price extraction ---------- */

// Only accept clean standalone prices: $297, $2,000/mo, $497 per month
// Lookahead after digits: next char must NOT be another digit, comma, or revenue suffix (k/M/B)
// This prevents backtracking from matching $1 out of $10k
const CLEAN_PRICE = /\$[\d,]+(?:\.\d{2})?(?=[^kKmMbB\d,]|$)(?:\s*(?:\/\s*)?(?:mo(?:nth)?|yr|year|week|wk|per\s+(?:month|year|person|seat|producer|member)))?/i;

export function extractCleanPrice(text: string): string | null {
  const match = text.match(CLEAN_PRICE);
  if (!match) return null;
  const raw = match[0].trim();
  if (raw.length < 2 || raw.length > 40) return null;
  return raw;
}

/* ---------- Strict CTA extraction ---------- */

const CTA_BUTTON_PATTERN = /\b(join|apply|book|schedule|start|enroll|sign\s*up|get\s+started|buy|purchase|reserve|claim|try|watch|download)\b/i;
const CTA_MAX_WORDS = 7;
const CTA_MIN_WORDS = 2;

export function extractCleanCta(text: string): string | null {
  // Try to find a short CTA-like phrase (2-7 words)
  const sentences = splitSentences(text);
  for (const s of sentences) {
    if (!CTA_BUTTON_PATTERN.test(s)) continue;
    // If the sentence itself is short enough, use it directly
    const words = s.split(/\s+/);
    if (words.length >= CTA_MIN_WORDS && words.length <= CTA_MAX_WORDS) {
      return s.replace(/[.!?]+$/, '').trim();
    }
    // Try to extract a CTA clause from the sentence
    const clauses = s.split(/[,;:–—]/);
    for (const clause of clauses) {
      const trimmed = clause.trim();
      const cWords = trimmed.split(/\s+/);
      if (CTA_BUTTON_PATTERN.test(trimmed) && cWords.length >= CTA_MIN_WORDS && cWords.length <= CTA_MAX_WORDS) {
        return trimmed.replace(/[.!?]+$/, '').trim();
      }
    }
  }
  return null;
}

/* ---------- Best-for extraction ---------- */

const BEST_FOR_PATTERN = /\b(?:for|designed for|ideal for|best for|built for|perfect for|suited for|tailored (?:for|to)|helps?|aimed at|targeting|who:?)\s+(.{10,120}?)(?:\.|$)/i;

function extractBestFor(text: string): string | null {
  const match = text.match(BEST_FOR_PATTERN);
  if (!match) return null;
  const raw = match[1].trim();
  return raw.length >= 5 ? raw : null;
}

/* ---------- Section-boundary extraction ---------- */

/** Extract a single offer from a section whose heading matches a canonical offer. */
function extractOfferFromSection(canonicalName: string, sectionText: string): StructuredOffer {
  return {
    offer_name: canonicalName,
    best_for: extractBestFor(sectionText),
    price: extractCleanPrice(sectionText),
    cta_text: extractCleanCta(sectionText)
  };
}

/** Extract offers from sentences within a single text block (no section headings). */
function extractOffersFromSentences(sentences: string[]): StructuredOffer[] {
  const offers: StructuredOffer[] = [];
  const seenCanonical = new Set<string>();

  for (const sentence of sentences) {
    const canonical = matchCanonicalOffer(sentence);
    if (!canonical) continue;
    if (seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);

    // Extract fields ONLY from this sentence (boundary-locked)
    offers.push({
      offer_name: canonical,
      best_for: extractBestFor(sentence),
      price: extractCleanPrice(sentence),
      cta_text: extractCleanCta(sentence)
    });
  }

  return offers;
}

/** Extract structured offers from section-scoped chunks. */
export function extractStructuredOffers(chunks: RetrievedChunk[]): StructuredOffer[] {
  // Group chunks by section_title
  const sectionMap = new Map<string, string[]>();
  for (const chunk of chunks) {
    const key = chunk.section_title || '__untitled__';
    const list = sectionMap.get(key) || [];
    list.push(cleanChunkText(chunk.text));
    sectionMap.set(key, list);
  }

  const offers: StructuredOffer[] = [];
  const seenCanonical = new Set<string>();

  for (const [sectionTitle, texts] of sectionMap) {
    const fullText = texts.join(' ');

    // Check if section title matches a canonical offer
    const titleCanonical = sectionTitle !== '__untitled__' ? matchCanonicalOffer(sectionTitle) : null;

    if (titleCanonical && !seenCanonical.has(titleCanonical)) {
      // Section heading matches — extract from this section only
      seenCanonical.add(titleCanonical);
      offers.push(extractOfferFromSection(titleCanonical, fullText));
    } else {
      // Scan sentences for canonical offer mentions
      const sentences = splitSentences(fullText);
      const sentenceOffers = extractOffersFromSentences(sentences);
      for (const offer of sentenceOffers) {
        if (!seenCanonical.has(offer.offer_name)) {
          seenCanonical.add(offer.offer_name);
          offers.push(offer);
        }
      }
    }
  }

  return offers;
}

/* ---------- Quality gate ---------- */

const MIN_CLEAN_OFFERS = 2;

function isCleanOfferName(name: string): boolean {
  // Must match a canonical offer
  return matchCanonicalOffer(name) !== null;
}

export function passesQualityGate(offers: StructuredOffer[]): boolean {
  const clean = offers.filter((o) => isCleanOfferName(o.offer_name));
  return clean.length >= MIN_CLEAN_OFFERS;
}

/* ------------------------------------------------------------------ */
/*  Format structured offer rows                                       */
/* ------------------------------------------------------------------ */

function formatOfferBullet(offer: StructuredOffer): string {
  let line = offer.offer_name;
  if (offer.best_for) line += `: ${offer.best_for}`;
  if (offer.price) line += ` (${offer.price})`;
  return truncateBullet(line);
}

/* ------------------------------------------------------------------ */
/*  Main synthesis entry point                                         */
/* ------------------------------------------------------------------ */

interface CitationEntry { index: number; title: string; url: string }

export interface SynthesisResult {
  answerLines: string[];
  isStructured: boolean;
  lowConfidence: boolean;
}

export function synthesize(
  question: string,
  chunks: RetrievedChunk[],
  citationMap: Map<number, CitationEntry>
): SynthesisResult {
  const intent = detectIntent(question);
  const filtered = filterNoisyChunks(chunks);
  const workingChunks = filtered.length > 0 ? filtered : chunks;

  const avgScore = workingChunks.reduce((sum, c) => sum + c.final_score, 0) / Math.max(workingChunks.length, 1);
  const lowConfidence = avgScore < 0.3;

  const cleanedTexts = workingChunks.map((c) => cleanChunkText(c.text));
  const avgCleanLen = cleanedTexts.reduce((sum, t) => sum + t.length, 0) / Math.max(cleanedTexts.length, 1);
  const tooNoisy = avgCleanLen < 30;

  if (tooNoisy) {
    return {
      answerLines: ['- Retrieved text is too noisy for confident synthesis. Try ingesting cleaner sources or narrowing filters.'],
      isStructured: false,
      lowConfidence: true
    };
  }

  if (intent === 'offer_structure') {
    return synthesizeStructured(question, workingChunks, citationMap, lowConfidence);
  }

  return synthesizeGeneral(question, workingChunks, citationMap, lowConfidence);
}

function synthesizeGeneral(
  question: string,
  chunks: RetrievedChunk[],
  citationMap: Map<number, CitationEntry>,
  lowConfidence: boolean
): SynthesisResult {
  const spans = extractKeySpans(chunks, question, MAX_BULLETS);
  const hasSingleSource = citationMap.size === 1;

  const bullets = spans.map((s) => {
    const cite = citationMap.get(s.sourceId);
    const ref = cite && !hasSingleSource ? ` [${cite.index}]` : '';
    return `- ${truncateBullet(s.text)}${ref}`;
  });

  if (hasSingleSource && bullets.length > 0) {
    const cite = citationMap.values().next().value as CitationEntry;
    bullets[bullets.length - 1] += ` [${cite.index}]`;
  }

  return { answerLines: bullets, isStructured: false, lowConfidence };
}

function synthesizeStructured(
  question: string,
  chunks: RetrievedChunk[],
  citationMap: Map<number, CitationEntry>,
  lowConfidence: boolean
): SynthesisResult {
  const structuredOffers = extractStructuredOffers(chunks);

  // Quality gate: need >=2 clean canonical offers, otherwise fallback
  if (!passesQualityGate(structuredOffers)) {
    const result = synthesizeGeneral(question, chunks, citationMap, true);
    return {
      answerLines: [
        ...result.answerLines,
        '',
        '  Note: Could not confidently extract structured offers. Showing general synthesis.'
      ],
      isStructured: false,
      lowConfidence: true
    };
  }

  const lines: string[] = [];
  lines.push('Offer structure:');
  for (const offer of structuredOffers) {
    lines.push(`- ${formatOfferBullet(offer)}`);
  }

  // Collect clean CTAs from offers
  const ctaLines = structuredOffers
    .filter((o) => o.cta_text)
    .map((o) => o.cta_text!);
  const uniqueCtas = deduplicateSpans(ctaLines);

  // Also scan chunks for additional short CTAs
  const allText = chunks.map((c) => cleanChunkText(c.text)).join(' ');
  const candidate = extractCleanCta(allText);
  if (candidate && uniqueCtas.length < 3) {
    const deduped = deduplicateSpans([...uniqueCtas, candidate]);
    if (deduped.length > uniqueCtas.length) {
      uniqueCtas.push(candidate);
    }
  }

  if (uniqueCtas.length > 0) {
    lines.push('');
    lines.push('CTA flow:');
    for (const c of uniqueCtas.slice(0, 3)) lines.push(`- ${c}`);
  }

  // Append citation ref to last bullet
  const hasSingleSource = citationMap.size === 1;
  if (hasSingleSource) {
    const cite = citationMap.values().next().value as CitationEntry;
    const lastBulletIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.startsWith('- ')).pop()?.i;
    if (lastBulletIdx !== undefined) {
      lines[lastBulletIdx] += ` [${cite.index}]`;
    }
  }

  return { answerLines: lines, isStructured: true, lowConfidence };
}
