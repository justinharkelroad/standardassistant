import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/utils/chunking.js';

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
});
