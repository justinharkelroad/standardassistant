import { SourceType } from '../types.js';

export interface RankingWeights {
  semantic: number;
  recency: number;
  source: number;
}

export interface SourceWeightProfile {
  name: string;
  weights: Record<SourceType, number>;
}

const profiles: Record<string, SourceWeightProfile> = {
  balanced: {
    name: 'balanced',
    weights: { article: 1, pdf: 1.1, youtube: 0.9, twitter: 0.85, tiktok: 0.75, unknown: 1 }
  },
  research: {
    name: 'research',
    weights: { article: 1.05, pdf: 1.2, youtube: 0.8, twitter: 0.7, tiktok: 0.65, unknown: 1 }
  },
  social: {
    name: 'social',
    weights: { article: 0.95, pdf: 1, youtube: 1, twitter: 1.05, tiktok: 1.1, unknown: 1 }
  }
};

function parseJsonObject<T extends object>(value: string | undefined): Partial<T> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function getRankingWeights(): RankingWeights {
  const defaults: RankingWeights = { semantic: 0.65, recency: 0.2, source: 0.15 };
  const env = parseJsonObject<RankingWeights>(process.env.KB_RANKING_WEIGHTS_JSON);
  const semantic = Number(env.semantic ?? defaults.semantic);
  const recency = Number(env.recency ?? defaults.recency);
  const source = Number(env.source ?? defaults.source);
  const sum = semantic + recency + source;
  if (!sum || !Number.isFinite(sum)) return defaults;
  return {
    semantic: semantic / sum,
    recency: recency / sum,
    source: source / sum
  };
}

export function getSourceWeightProfile(): SourceWeightProfile {
  const name = (process.env.KB_SOURCE_WEIGHT_PROFILE || 'balanced').toLowerCase();
  const base = profiles[name] || profiles.balanced;
  const overrides = parseJsonObject<Record<string, number>>(process.env.KB_SOURCE_WEIGHT_OVERRIDES_JSON);
  const merged = { ...base.weights };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in merged && typeof v === 'number' && Number.isFinite(v)) {
      (merged as any)[k] = v;
    }
  }
  return { name: base.name, weights: merged };
}

export function sourceWeightFor(type: SourceType): number {
  return getSourceWeightProfile().weights[type] ?? 1;
}

export function recencyHalfLifeDays(): number {
  const parsed = Number(process.env.KB_RECENCY_HALF_LIFE_DAYS || 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function finalRank(semantic: number, recency: number, sourceWeight: number): number {
  const w = getRankingWeights();
  return semantic * w.semantic + recency * w.recency + sourceWeight * w.source;
}
