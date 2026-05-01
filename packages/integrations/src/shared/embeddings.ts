// OpenAI text-embedding-3-small client. 1536-dim, $0.02 / 1M tokens.
// Pulled into shared/ because Fathom (M5.3) and the agent runtime memory
// hydration (M5.5) both call it.
//
// Single env: OPENAI_API_KEY. Returns a vector per input string. Hits
// /v1/embeddings with model="text-embedding-3-small".

const OPENAI_BASE = "https://api.openai.com/v1";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

export type EmbeddingResult = {
  vectors: number[][];
  totalTokens: number;
};

export async function embedTexts(inputs: string[]): Promise<EmbeddingResult> {
  if (inputs.length === 0) return { vectors: [], totalTokens: 0 };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { total_tokens: number };
  };
  // Sort by index to be safe — OpenAI documents that data is returned in
  // request order, but we don't rely on it.
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return {
    vectors: sorted.map((d) => d.embedding),
    totalTokens: json.usage?.total_tokens ?? 0,
  };
}
