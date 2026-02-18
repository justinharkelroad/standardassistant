export function simpleTokenCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function chunkText(text: string, maxTokens = 220, overlap = 40): string[] {
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
