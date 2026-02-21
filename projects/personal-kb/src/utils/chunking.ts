export function simpleTokenCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function chunkText(text: string, maxTokens = 350, overlap = 60): string[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const end = Math.min(i + maxTokens, tokens.length);
    chunks.push(tokens.slice(i, end).join(' '));
    if (end >= tokens.length) break;
    i = Math.max(end - overlap, i + 1);
  }

  return chunks;
}

export interface SectionChunk {
  text: string;
  sectionTitle: string | null;
}

export function chunkBySections(
  sections: Array<{ title: string; body: string }>,
  maxTokens = 350,
  overlap = 60
): SectionChunk[] {
  const result: SectionChunk[] = [];

  for (const section of sections) {
    const subChunks = chunkText(section.body, maxTokens, overlap);
    const title = section.title || null;
    for (const text of subChunks) {
      result.push({ text, sectionTitle: title });
    }
  }

  return result;
}

export interface PlainTextSection {
  title: string;
  body: string;
}

/**
 * Detect plain-text headings (ALL CAPS lines, colon-terminated short lines)
 * and split text into sections. Falls back to a single section when no
 * headings are found.
 */
export function splitTextBySections(text: string): PlainTextSection[] {
  const lines = text.split('\n');
  const sections: PlainTextSection[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];

  function isAllCapsHeading(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const words = trimmed.split(/\s+/);
    if (words.length < 2 || trimmed.length > 120) return false;
    // Must be all uppercase with no lowercase letters
    return /[A-Z]/.test(trimmed) && !/[a-z]/.test(trimmed);
  }

  function isColonHeading(line: string, prevLine: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 120) return false;
    // Must end with colon, be short (<=10 words), and preceded by a blank line
    if (!trimmed.endsWith(':')) return false;
    const words = trimmed.split(/\s+/);
    if (words.length > 10) return false;
    return prevLine.trim() === '';
  }

  function flush() {
    const body = currentBody.join('\n').trim();
    if (currentTitle || body) {
      sections.push({ title: currentTitle, body });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';

    if (isAllCapsHeading(line) || isColonHeading(line, prevLine)) {
      flush();
      currentTitle = line.trim().replace(/:$/, '');
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  flush();

  // Fallback: no headings detected → single section
  if (sections.length <= 1 && sections.every(s => !s.title)) {
    return [{ title: '', body: text.trim() }];
  }

  return sections;
}
