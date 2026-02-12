/**
 * Configurable LLM client. Uses config.json; env overrides: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
 * Works with LM Studio, Ollama, OpenAI, or any OpenAI-compatible API.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const path = join(__dirname, 'config.json');
  const raw = readFileSync(path, 'utf8');
  const config = JSON.parse(raw);
  return {
    baseUrl: process.env.LLM_BASE_URL || config.llm.baseUrl,
    apiKey: process.env.LLM_API_KEY ?? config.llm.apiKey,
    model: process.env.LLM_MODEL || config.llm.model,
    maxTokens: config.llm.maxTokens ?? 2048,
  };
}

/**
 * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} messages
 * @returns {Promise<string>}
 */
export async function chat(messages) {
  const { baseUrl, apiKey, model, maxTokens } = loadConfig();
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey && apiKey !== 'not-needed' && { Authorization: `Bearer ${apiKey}` }),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (content == null) throw new Error('No content in LLM response');
  return content.trim();
}

export { loadConfig };
