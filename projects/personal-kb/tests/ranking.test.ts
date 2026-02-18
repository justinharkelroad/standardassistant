import { describe, it, expect } from 'vitest';
import { finalRank, recencyBoost } from '../src/retrieval/search.js';

describe('ranking', () => {
  it('boosts newer content over old given same semantic/source score', () => {
    const recent = recencyBoost(new Date().toISOString());
    const old = recencyBoost(new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString());
    expect(recent).toBeGreaterThan(old);
  });

  it('applies configured weighted formula', () => {
    const score = finalRank(0.8, 0.5, 1.0);
    expect(score).toBeCloseTo(0.8 * 0.65 + 0.5 * 0.2 + 1.0 * 0.15, 6);
  });
});
