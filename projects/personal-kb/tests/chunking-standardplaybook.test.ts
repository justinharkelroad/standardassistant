import { describe, it, expect } from 'vitest';
import { splitTextBySections, chunkBySections } from '../src/utils/chunking.js';

/**
 * Simulate a standardplaybook.com-like page: ~10 ALL CAPS section headings
 * with ~400 words each, totalling ~4000 words.
 */
function buildStandardPlaybookFixture(): string {
  const sectionTitles = [
    'THE STANDARD OFFER',
    'WHY IT WORKS',
    'PRICING YOUR OFFER',
    'GUARANTEE STRUCTURE',
    'DELIVERY MECHANISM',
    'BONUS STACKING',
    'URGENCY AND SCARCITY',
    'NAMING YOUR OFFER',
    'LAUNCH SEQUENCE',
    'SCALING THE OFFER',
  ];

  const lines: string[] = [];
  for (const title of sectionTitles) {
    lines.push('');
    lines.push(title);
    // ~400 words of body per section (ensures >1 chunk per section with maxTokens=350)
    const body = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}

describe('standardplaybook-like chunking', () => {
  const fixture = buildStandardPlaybookFixture();

  it('splitTextBySections detects all 10 sections', () => {
    const sections = splitTextBySections(fixture);
    expect(sections.length).toBe(10);
    expect(sections[0].title).toBe('THE STANDARD OFFER');
    expect(sections[9].title).toBe('SCALING THE OFFER');
  });

  it('produces well over 4 chunks from ~2500 words with 10 sections', () => {
    const sections = splitTextBySections(fixture);
    const chunks = chunkBySections(sections);

    // 10 sections * 400 words each, maxTokens=350 → at least 10+ chunks
    expect(chunks.length).toBeGreaterThan(10);
  });

  it('preserves section titles in chunk metadata', () => {
    const sections = splitTextBySections(fixture);
    const chunks = chunkBySections(sections);

    const titles = new Set(chunks.map(c => c.sectionTitle).filter(Boolean));
    expect(titles.has('THE STANDARD OFFER')).toBe(true);
    expect(titles.has('SCALING THE OFFER')).toBe(true);
    expect(titles.size).toBe(10);
  });
});
