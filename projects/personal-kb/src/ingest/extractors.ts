import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { YoutubeTranscript } from 'youtube-transcript';
import { SourceType } from '../types.js';

export type RelationType = 'thread_reply' | 'quote_of' | 'links_to';

export interface ExtractedContent {
  type: SourceType;
  title?: string;
  author?: string;
  publishedAt?: string;
  text: string;
  metadata?: Record<string, unknown>;
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
    metadata
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
      metadata
    },
    related: []
  };
}

export async function extractFromUrl(url: string): Promise<ExtractedBundle> {
  if (isYouTubeUrl(url)) {
    const id = youtubeVideoId(url);
    if (!id) throw new Error('Could not parse YouTube video ID');
    const transcript = await YoutubeTranscript.fetchTranscript(id);
    const text = transcript.map((t) => t.text).join(' ');
    return {
      source: { type: 'youtube', text, metadata: { videoId: id, transcriptCount: transcript.length } },
      related: []
    };
  }

  if (isTwitterUrl(url)) {
    return extractTwitter(url);
  }

  if (isTikTokUrl(url)) {
    return extractTikTok(url);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';

  if (isPdfUrl(url) || contentType.includes('application/pdf')) {
    const arr = await res.arrayBuffer();
    const { default: pdf } = await import('pdf-parse');
    const parsed = await pdf(Buffer.from(arr));
    return { source: { type: 'pdf', text: parsed.text, metadata: { pages: parsed.numpages } }, related: [] };
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.textContent?.trim()) {
    const bodyText = dom.window.document.body?.textContent || '';
    return {
      source: { type: 'article', title: dom.window.document.title, text: bodyText.trim() },
      related: []
    };
  }

  return {
    source: {
      type: 'article',
      title: article.title || undefined,
      author: article.byline || undefined,
      text: article.textContent,
      metadata: { excerpt: article.excerpt, siteName: article.siteName }
    },
    related: []
  };
}
