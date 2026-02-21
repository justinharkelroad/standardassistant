import { describe, it, expect } from 'vitest';
import { chunkText, chunkBySections, splitTextBySections } from '../src/utils/chunking.js';

describe('chunkText', () => {
  it('creates overlapping chunks with bounded size', () => {
    const text = Array.from({ length: 600 }, (_, i) => `tok${i}`).join(' ');
    const chunks = chunkText(text, 100, 20);

    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      const tokens = c.split(/\s+/).length;
      expect(tokens).toBeLessThanOrEqual(100);
    }
  });

  it('uses raised defaults (350 maxTokens, 60 overlap)', () => {
    // 700 tokens should produce ~2-3 chunks with maxTokens=350
    const text = Array.from({ length: 700 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(text);
    // With 350 max, 700 tokens → exactly 2-3 chunks (not 4+)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
    for (const c of chunks) {
      const tokens = c.split(/\s+/).length;
      expect(tokens).toBeLessThanOrEqual(350);
    }
  });
});

describe('chunkBySections defaults', () => {
  it('uses raised defaults matching chunkText', () => {
    const sections = [
      { title: 'Section A', body: Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ') },
    ];
    const result = chunkBySections(sections);
    // 400 tokens with 350 max → 2 chunks
    expect(result.length).toBe(2);
    expect(result[0].sectionTitle).toBe('Section A');
  });
});

describe('splitTextBySections', () => {
  it('detects ALL CAPS headings', () => {
    const text = [
      'SECTION ONE HEADING',
      'Body of section one goes here with some text.',
      '',
      'SECTION TWO HEADING',
      'Body of section two with more content here.',
    ].join('\n');

    const sections = splitTextBySections(text);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe('SECTION ONE HEADING');
    expect(sections[0].body).toContain('Body of section one');
    expect(sections[1].title).toBe('SECTION TWO HEADING');
    expect(sections[1].body).toContain('Body of section two');
  });

  it('detects colon-terminated headings preceded by blank lines', () => {
    const text = [
      'Some intro text here.',
      '',
      'First Topic:',
      'Details about the first topic.',
      '',
      'Second Topic:',
      'Details about the second topic.',
    ].join('\n');

    const sections = splitTextBySections(text);
    expect(sections.length).toBe(3);
    expect(sections[0].title).toBe('');
    expect(sections[0].body).toContain('intro text');
    expect(sections[1].title).toBe('First Topic');
    expect(sections[2].title).toBe('Second Topic');
  });

  it('falls back to single section when no headings found', () => {
    const text = 'Just a plain paragraph with no headings at all. Nothing special here.';
    const sections = splitTextBySections(text);
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe('');
    expect(sections[0].body).toBe(text);
  });

  it('ignores single-word ALL CAPS (not a heading)', () => {
    const text = [
      'WORD',
      'This is not a heading because it is a single word.',
      'More content here.',
    ].join('\n');

    const sections = splitTextBySections(text);
    expect(sections.length).toBe(1);
  });

  it('ignores ALL CAPS lines longer than 120 chars', () => {
    const longCaps = 'A '.repeat(65).trim(); // >120 chars
    const text = [longCaps, 'Body text after a very long caps line.'].join('\n');
    const sections = splitTextBySections(text);
    expect(sections.length).toBe(1);
  });
});
