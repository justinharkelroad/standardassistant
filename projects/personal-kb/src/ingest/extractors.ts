import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import pdf from 'pdf-parse';
import { YoutubeTranscript } from 'youtube-transcript';
import { SourceType } from '../types.js';

export interface ExtractedContent {
  type: SourceType;
  title?: string;
  author?: string;
  publishedAt?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|\?)/i.test(url);
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

export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  if (isYouTubeUrl(url)) {
    const id = youtubeVideoId(url);
    if (!id) throw new Error('Could not parse YouTube video ID');
    const transcript = await YoutubeTranscript.fetchTranscript(id);
    const text = transcript.map((t) => t.text).join(' ');
    return { type: 'youtube', text, metadata: { videoId: id, transcriptCount: transcript.length } };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';

  if (isPdfUrl(url) || contentType.includes('application/pdf')) {
    const arr = await res.arrayBuffer();
    const parsed = await pdf(Buffer.from(arr));
    return { type: 'pdf', text: parsed.text, metadata: { pages: parsed.numpages } };
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.textContent?.trim()) {
    const bodyText = dom.window.document.body?.textContent || '';
    return { type: 'article', title: dom.window.document.title, text: bodyText.trim() };
  }

  return {
    type: 'article',
    title: article.title || undefined,
    author: article.byline || undefined,
    text: article.textContent,
    metadata: { excerpt: article.excerpt, siteName: article.siteName }
  };
}
