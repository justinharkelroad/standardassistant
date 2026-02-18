import { ExtractedContent } from './extractors.js';

export function buildIngestionSummary(url: string, sourceId: number, extracted: ExtractedContent, chunks: number): string {
  const preview = (extracted.text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  return [
    `✅ Ingested source #${sourceId}`,
    `URL: ${url}`,
    `Type: ${extracted.type}`,
    `Method: ${extracted.extractionMethod} (confidence ${extracted.extractionConfidence.toFixed(2)})`,
    `Chunks: ${chunks}`,
    preview ? `Preview: ${preview}${preview.length >= 280 ? '…' : ''}` : null
  ]
    .filter(Boolean)
    .join('\n');
}
