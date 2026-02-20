import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { YoutubeTranscript } from 'youtube-transcript';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SourceType } from '../types.js';
import { resolveBrowserRelayExtractCmd } from '../config.js';

const execFileAsync = promisify(execFile);

export type RelationType = 'thread_reply' | 'quote_of' | 'links_to';
export type ExtractionMethod = 'web_fetch' | 'browser_relay' | 'api';

export interface ContentSection {
  title: string;
  body: string;
}

export interface ExtractedContent {
  type: SourceType;
  title?: string;
  author?: string;
  publishedAt?: string;
  text: string;
  sections?: ContentSection[];
  metadata?: Record<string, unknown>;
  extractionMethod: ExtractionMethod;
  extractionConfidence: number;
}

export interface RelatedSource {
  relationType: RelationType;
  url: string;
  extracted?: ExtractedContent;
}

export interface ExtractedBundle {
  source: ExtractedContent;
  related: RelatedSource[];
}

export interface ExtractionOptions {
  browserRelayFallbackEnabled?: boolean;
  minReadableChars?: number;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|\?)/i.test(url);
}

function isTwitterUrl(url: string): boolean {
  return /(?:twitter\.com|x\.com)\/(?:[^/]+|i\/web)\/status\//i.test(url);
}

function isTikTokUrl(url: string): boolean {
  return /(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i.test(url);
}

function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

function twitterStatusId(url: string): string | null {
  const m = url.match(/status\/(\d+)/i);
  return m?.[1] || null;
}

function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s)\]}>"']+/gi)).map((m) => m[0]);
}

async function resolveFinalUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.url || url;
  } catch {
    return url;
  }
}

function normalizeSocialText(text?: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function looksPaywalledOrBlocked(status: number, html: string): boolean {
  const lower = html.toLowerCase();
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 451 ||
    lower.includes('subscribe to continue') ||
    lower.includes('sign in to continue') ||
    lower.includes('this content is for subscribers') ||
    lower.includes('paywall')
  );
}

export function shouldUseBrowserRelayFallback(params: {
  enabled: boolean;
  status: number;
  html: string;
  readableTextLength: number;
  minReadableChars: number;
}): boolean {
  return (
    params.enabled &&
    (looksPaywalledOrBlocked(params.status, params.html) || params.readableTextLength < params.minReadableChars)
  );
}

export async function extractViaBrowserRelay(url: string): Promise<{ title?: string; text: string; metadata?: Record<string, unknown>; confidence?: number }> {
  const cmd = resolveBrowserRelayExtractCmd();
  if (!cmd) {
    throw new Error(
      'Browser relay extraction command not configured. Set KB_BROWSER_RELAY_EXTRACT_CMD or add executable scripts/browser-relay-extract.mjs.'
    );
  }

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync(cmd, [url, '--timeout-ms', String(Number(process.env.KB_BROWSER_RELAY_TIMEOUT_MS || 45000))], {
      timeout: Number(process.env.KB_BROWSER_RELAY_TIMEOUT_MS || 45000)
    }));
  } catch (error: any) {
    const hint = error?.code === 'ENOENT'
      ? `Command not found: ${cmd}`
      : error?.stderr
        ? String(error.stderr)
        : error?.message || String(error);
    throw new Error(`Browser relay extractor failed. ${hint}`);
  }

  let parsed: { title?: string; text?: string; metadata?: Record<string, unknown>; confidence?: number };
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch {
    throw new Error('Browser relay extractor returned invalid JSON. Expected {title,text,metadata,confidence}.');
  }

  if (!parsed.text?.trim()) throw new Error('Browser relay extractor returned empty text');
  return { title: parsed.title, text: parsed.text, metadata: parsed.metadata || {}, confidence: parsed.confidence };
}

async function extractTwitter(url: string, seen = new Set<string>()): Promise<ExtractedBundle> {
  const id = twitterStatusId(url);
  if (!id) throw new Error('Could not parse Twitter status ID');

  const resultUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en`;
  const res = await fetch(resultUrl);
  if (!res.ok) throw new Error(`Twitter syndication fetch failed: ${res.status}`);
  const json = (await res.json()) as any;

  const rawText = normalizeSocialText(json.text || json.full_text || '');
  const authorHandle = json.user?.screen_name || json.user?.name;
  const createdAt = json.created_at ? new Date(json.created_at).toISOString() : undefined;
  const links = [
    ...(Array.isArray(json.entities?.urls) ? json.entities.urls.map((u: any) => u.expanded_url || u.url).filter(Boolean) : []),
    ...extractUrls(rawText)
  ].filter((u: string) => !/(?:twitter\.com|x\.com)\//i.test(u));

  const metadata = {
    tweetId: id,
    conversationId: json.conversation_id_str,
    inReplyToStatusId: json.in_reply_to_status_id_str,
    authorHandle,
    authorName: json.user?.name,
    postTimestamp: createdAt,
    engagement: {
      likes: asNumber(json.favorite_count),
      replies: asNumber(json.reply_count),
      reposts: asNumber(json.retweet_count),
      quotes: asNumber(json.quote_count)
    },
    outboundUrls: Array.from(new Set(links))
  };

  const source: ExtractedContent = {
    type: 'twitter',
    title: rawText.slice(0, 90) || `Tweet ${id}`,
    author: authorHandle,
    publishedAt: createdAt,
    text: rawText,
    metadata,
    extractionMethod: 'api',
    extractionConfidence: 0.92
  };

  const related: RelatedSource[] = [];

  for (const link of metadata.outboundUrls) {
    related.push({ relationType: 'links_to', url: link });
  }

  if (json.quoted_tweet?.id_str) {
    const quoteId = String(json.quoted_tweet.id_str);
    const quoteUrl = `https://x.com/i/web/status/${quoteId}`;
    related.push({ relationType: 'quote_of', url: quoteUrl });
  }

  const replyTo = json.in_reply_to_status_id_str ? String(json.in_reply_to_status_id_str) : null;
  if (replyTo) {
    const parentUrl = `https://x.com/i/web/status/${replyTo}`;
    if (!seen.has(parentUrl)) {
      seen.add(parentUrl);
      related.push({ relationType: 'thread_reply', url: parentUrl });
    }
  }

  return { source, related };
}

function pickLargestTranscript(transcript: any): string {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript)) {
    return transcript
      .map((x) => (typeof x === 'string' ? x : x?.text || ''))
      .join(' ')
      .trim();
  }
  if (typeof transcript === 'object') {
    const values = Object.values(transcript)
      .map((v) => pickLargestTranscript(v))
      .filter(Boolean);
    return values.sort((a, b) => b.length - a.length)[0] || '';
  }
  return '';
}

async function extractTikTok(url: string): Promise<ExtractedBundle> {
  const resolvedUrl = await resolveFinalUrl(url);
  const pageRes = await fetch(resolvedUrl);
  if (!pageRes.ok) throw new Error(`TikTok fetch failed: ${pageRes.status}`);
  const html = await pageRes.text();

  const dom = new JSDOM(html, { url: resolvedUrl });
  const scriptJson = dom.window.document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent;

  let parsed: any = null;
  try {
    if (scriptJson) parsed = JSON.parse(scriptJson);
  } catch {
    parsed = null;
  }

  const bodyText = normalizeSocialText(dom.window.document.body?.textContent || '');
  const title = dom.window.document.title || 'TikTok post';

  let post: any = null;
  try {
    const itemModule = parsed?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    post = itemModule || null;
  } catch {
    post = null;
  }

  const caption = normalizeSocialText(post?.desc || '');
  const transcript = pickLargestTranscript(post?.video?.subtitleInfos || post?.music || null);
  const fallbackText = [caption, transcript, bodyText].filter(Boolean).join('\n\n').slice(0, 20000);

  const authorHandle = post?.author?.uniqueId;
  const createdAtSeconds = asNumber(post?.createTime);
  const createdAt = createdAtSeconds ? new Date(createdAtSeconds * 1000).toISOString() : undefined;

  const metadata = {
    resolvedUrl,
    authorHandle,
    authorName: post?.author?.nickname,
    postTimestamp: createdAt,
    engagement: {
      likes: asNumber(post?.stats?.diggCount),
      comments: asNumber(post?.stats?.commentCount),
      shares: asNumber(post?.stats?.shareCount),
      plays: asNumber(post?.stats?.playCount)
    },
    caption,
    transcriptAvailable: Boolean(transcript),
    musicTitle: post?.music?.title
  };

  return {
    source: {
      type: 'tiktok',
      title,
      author: authorHandle,
      publishedAt: createdAt,
      text: fallbackText || caption || title,
      metadata,
      extractionMethod: 'web_fetch',
      extractionConfidence: transcript ? 0.85 : 0.65
    },
    related: []
  };
}

export function extractSections(html: string, baseUrl?: string): ContentSection[] {
  const dom = new JSDOM(html, baseUrl ? { url: baseUrl } : undefined);
  const doc = dom.window.document;

  // Walk through top-level children of body (or article root)
  const root = doc.querySelector('article') || doc.body;
  if (!root) return [];

  const sections: ContentSection[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const node of Array.from(root.childNodes)) {
    const el = node as Element;
    const tag = el.tagName?.toLowerCase() || '';

    if (/^h[1-6]$/.test(tag)) {
      // Flush previous section
      const bodyText = currentBody.join(' ').replace(/\s+/g, ' ').trim();
      if (bodyText) {
        sections.push({ title: currentTitle, body: bodyText });
      }
      currentTitle = (el.textContent || '').replace(/\s+/g, ' ').trim();
      currentBody = [];
    } else {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) currentBody.push(text);
    }
  }

  // Flush last section
  const lastBody = currentBody.join(' ').replace(/\s+/g, ' ').trim();
  if (lastBody) {
    sections.push({ title: currentTitle, body: lastBody });
  }

  return sections.filter((s) => s.body.length >= 20);
}

export async function extractFromUrl(url: string, options: ExtractionOptions = {}): Promise<ExtractedBundle> {
  const minReadableChars = options.minReadableChars || Number(process.env.KB_MIN_READABLE_CHARS || 300);

  if (isYouTubeUrl(url)) {
    const id = youtubeVideoId(url);
    if (!id) throw new Error('Could not parse YouTube video ID');
    const transcript = await YoutubeTranscript.fetchTranscript(id);
    const text = transcript.map((t) => t.text).join(' ');
    return {
      source: {
        type: 'youtube',
        text,
        metadata: { videoId: id, transcriptCount: transcript.length },
        extractionMethod: 'api',
        extractionConfidence: transcript.length > 0 ? 0.93 : 0.6
      },
      related: []
    };
  }

  if (isTwitterUrl(url)) return extractTwitter(url);
  if (isTikTokUrl(url)) return extractTikTok(url);

  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    if (options.browserRelayFallbackEnabled) {
      const relay = await extractViaBrowserRelay(url);
      return {
        source: {
          type: 'article',
          title: relay.title,
          text: relay.text,
          metadata: relay.metadata,
          extractionMethod: 'browser_relay',
          extractionConfidence: relay.confidence ?? 0.55
        },
        related: []
      };
    }
    throw new Error(`Fetch failed: ${res.status}`);
  }

  if (isPdfUrl(url) || contentType.includes('application/pdf')) {
    const arr = await res.arrayBuffer();
    const { default: pdf } = await import('pdf-parse');
    const parsed = await pdf(Buffer.from(arr));
    return {
      source: {
        type: 'pdf',
        text: parsed.text,
        metadata: { pages: parsed.numpages },
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.95
      },
      related: []
    };
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const readableText = article?.textContent?.trim() || '';

  const shouldFallback = shouldUseBrowserRelayFallback({
    enabled: Boolean(options.browserRelayFallbackEnabled),
    status: res.status,
    html,
    readableTextLength: readableText.length,
    minReadableChars
  });

  if (shouldFallback) {
    const relay = await extractViaBrowserRelay(url);
    return {
      source: {
        type: 'article',
        title: relay.title || article?.title || undefined,
        text: relay.text,
        metadata: { ...(relay.metadata || {}), fallbackReason: readableText.length < minReadableChars ? 'insufficient_readable_text' : 'blocked' },
        extractionMethod: 'browser_relay',
        extractionConfidence: relay.confidence ?? 0.7
      },
      related: []
    };
  }

  if (!readableText) {
    const bodyText = dom.window.document.body?.textContent || '';
    return {
      source: {
        type: 'article',
        title: dom.window.document.title,
        text: bodyText.trim(),
        extractionMethod: 'web_fetch',
        extractionConfidence: bodyText.trim().length > 0 ? 0.45 : 0.2
      },
      related: []
    };
  }

  const sections = article?.content ? extractSections(article.content, url) : undefined;

  return {
    source: {
      type: 'article',
      title: article?.title || undefined,
      author: article?.byline || undefined,
      text: readableText,
      sections: sections && sections.length > 0 ? sections : undefined,
      metadata: { excerpt: article?.excerpt, siteName: article?.siteName },
      extractionMethod: 'web_fetch',
      extractionConfidence: 0.88
    },
    related: []
  };
}
