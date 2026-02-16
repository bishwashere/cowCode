/**
 * Embedding API client. Calls OpenAI-compatible /embeddings endpoint.
 */

/**
 * Embed one or more texts. Returns array of float arrays.
 * @param {string[]} texts - Texts to embed.
 * @param {{ baseUrl: string, apiKey: string, model: string }} opts
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, opts) {
  if (!texts || texts.length === 0) return [];
  const { baseUrl, apiKey, model } = opts;
  const url = `${(baseUrl || '').replace(/\/$/, '')}/embeddings`;
  const body = {
    model: model || 'text-embedding-3-small',
    input: texts.length === 1 ? texts[0] : texts,
  };
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey && apiKey !== 'not-needed' && { Authorization: `Bearer ${apiKey}` }),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embeddings API failed ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  const list = data.data;
  if (!Array.isArray(list)) throw new Error('Embeddings API response missing data array');
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const emb = list[i].embedding;
    if (!Array.isArray(emb)) throw new Error(`Embedding ${i} is not an array`);
    out.push(emb.map(Number));
  }
  return out;
}
