import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recencyBoost } from '../src/retrieval/search.js';
import { finalRank, getRankingWeights, getSourceWeightProfile } from '../src/retrieval/ranking.js';

describe('ranking', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env = { ...prev };
    delete process.env.KB_RANKING_WEIGHTS_JSON;
    delete process.env.KB_SOURCE_WEIGHT_PROFILE;
    delete process.env.KB_SOURCE_WEIGHT_OVERRIDES_JSON;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it('boosts newer content over old given same semantic/source score', () => {
    const recent = recencyBoost(new Date().toISOString());
    const old = recencyBoost(new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString());
    expect(recent).toBeGreaterThan(old);
  });

  it('applies default weighted formula', () => {
    const score = finalRank(0.8, 0.5, 1.0);
    expect(score).toBeCloseTo(0.8 * 0.65 + 0.5 * 0.2 + 1.0 * 0.15, 6);
  });

  it('supports configurable ranking weights', () => {
    process.env.KB_RANKING_WEIGHTS_JSON = JSON.stringify({ semantic: 3, recency: 1, source: 1 });
    const weights = getRankingWeights();
    expect(weights.semantic).toBeCloseTo(0.6, 6);
    expect(weights.recency).toBeCloseTo(0.2, 6);
    expect(weights.source).toBeCloseTo(0.2, 6);
  });

  it('supports source weight profile overrides', () => {
    process.env.KB_SOURCE_WEIGHT_PROFILE = 'social';
    process.env.KB_SOURCE_WEIGHT_OVERRIDES_JSON = JSON.stringify({ twitter: 1.3 });
    const profile = getSourceWeightProfile();
    expect(profile.name).toBe('social');
    expect(profile.weights.twitter).toBe(1.3);
  });
});
