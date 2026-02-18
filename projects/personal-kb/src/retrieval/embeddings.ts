const EMBEDDING_DIMS = Number(process.env.EMBEDDING_DIMS || 384);

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash *= 16777619;
  }
  return Math.abs(hash >>> 0);
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (!norm) return v;
  return v.map((x) => x / norm);
}

function localEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIMS).fill(0);
  for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const idx = hashToken(token) % EMBEDDING_DIMS;
    vec[idx] += 1;
  }
  return normalize(vec);
}

export async function embedText(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

  if (!key) return localEmbedding(text);

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, input: text })
  });

  if (!res.ok) {
    return localEmbedding(text);
  }

  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0]?.embedding ?? localEmbedding(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}
