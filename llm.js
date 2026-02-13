/**
 * Configurable LLM client. All config values are read from .env (keys in config.json
 * are env var names). Supports preset providers and multiple models with priority.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** If config value is an env var name (e.g. "LLM_API_KEY"), return process.env[value]; else return value. */
function fromEnv(val) {
  if (val == null) return val;
  const s = String(val).trim();
  if (process.env[s] !== undefined) return process.env[s];
  return val;
}

/** Preset base URLs for standard providers (OpenAI-compatible except Anthropic). */
const PRESETS = {
  openai: 'https://api.openai.com/v1',
  grok: 'https://api.x.ai/v1',
  xai: 'https://api.x.ai/v1',
  together: 'https://api.together.xyz/v1',
  deepseek: 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

/** Only local providers can have baseUrl in config.json; others use preset only. */
const LOCAL_PROVIDERS = new Set(['lmstudio', 'ollama']);

/** Env var name for cloud model (e.g. openai -> OPENAI_MODEL). Used when model is omitted in config. */
function cloudModelEnv(provider) {
  if (!provider) return undefined;
  const p = String(provider).toLowerCase();
  const name = p === 'xai' ? 'GROK' : p.toUpperCase();
  return `${name}_MODEL`;
}

/** Default model per provider when the *_MODEL env var is not set. */
const DEFAULT_CLOUD_MODELS = {
  openai: 'gpt-4o-mini',
  grok: 'grok-2',
  xai: 'grok-2',
  anthropic: 'claude-3-5-sonnet-20241022',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  deepseek: 'deepseek-chat',
};

function loadConfig() {
  const path = join(__dirname, 'config.json');
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let config = {};
  if (raw && raw.trim()) {
    try {
      config = JSON.parse(raw);
    } catch (_) {
      // Invalid or truncated config; use defaults below.
    }
  }
  const llm = config.llm || {};
  const defaultMaxTokens = Number(fromEnv(llm.maxTokens)) || 2048;

  if (Array.isArray(llm.models) && llm.models.length > 0) {
    let models = llm.models.map((entry, i) => {
      const provider = entry.provider && String(entry.provider).toLowerCase();
      const isLocal = provider && LOCAL_PROVIDERS.has(provider);
      const baseUrl = isLocal
        ? (fromEnv(entry.baseUrl) || entry.baseUrl || (provider && PRESETS[provider]))
        : (entry.provider && PRESETS[provider]);
      const apiKey = fromEnv(entry.apiKey) ?? (i === 0 ? fromEnv('LLM_API_KEY') : undefined);
      const modelRaw = entry.model != null ? fromEnv(entry.model) : undefined;
      let model = modelRaw || (isLocal ? 'local' : fromEnv(cloudModelEnv(provider))) || (i === 0 ? fromEnv('LLM_MODEL') : undefined);
      if (!isLocal && (!model || model === cloudModelEnv(provider))) {
        model = DEFAULT_CLOUD_MODELS[provider] || model;
      }
      const maxTokens = Number(fromEnv(entry.maxTokens)) || defaultMaxTokens;
      const priority = entry.priority === true || entry.priority === 1 ||
        String(entry.priority).toLowerCase() === 'true' || entry.priority === '1';
      return {
        baseUrl: baseUrl || PRESETS.lmstudio,
        apiKey: apiKey ?? 'not-needed',
        model: model || 'local',
        maxTokens,
        priority,
      };
    });
    // When any model has priority, try it first regardless of position in config.
    const priorityIndex = models.findIndex((m) => m.priority);
    if (priorityIndex >= 0) {
      const [priorityModel] = models.splice(priorityIndex, 1);
      models = [priorityModel, ...models];
    }
    models = models.map(({ priority: _p, ...m }) => m);
    return { models, maxTokens: defaultMaxTokens };
  }

  const baseUrl = fromEnv('LLM_BASE_URL') || fromEnv(llm.baseUrl);
  const apiKey = fromEnv('LLM_API_KEY') ?? fromEnv(llm.apiKey);
  const model = fromEnv('LLM_MODEL') || fromEnv(llm.model);
  const maxTokens = Number(fromEnv(llm.maxTokens)) || 2048;
  return {
    models: [
      {
        baseUrl: baseUrl || PRESETS.lmstudio,
        apiKey: apiKey ?? 'not-needed',
        model: model || 'local',
        maxTokens,
      },
    ],
    maxTokens,
  };
}

/** Call Anthropic Messages API and return a Response-like with OpenAI-shaped JSON. */
async function callAnthropic(messages, { apiKey, model, maxTokens }, tools) {
  const url = 'https://api.anthropic.com/v1/messages';
  let system = '';
  const anthropicMessages = [];
  for (const m of messages) {
    const role = (m.role || '').toLowerCase();
    const content = typeof m.content === 'string' ? m.content : (m.content && m.content[0]?.text) || '';
    if (role === 'system') {
      system = (system ? system + '\n\n' : '') + content;
      continue;
    }
    if (role === 'user' || role === 'assistant') {
      anthropicMessages.push({ role, content });
    }
  }
  const body = {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
  };
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey || '',
    'anthropic-version': '2023-06-01',
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    return res;
  }
  const data = await res.json();
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  const openaiShape = { choices: [{ message: { content: text, tool_calls: [] } }] };
  return {
    ok: true,
    status: res.status,
    json: () => Promise.resolve(openaiShape),
    text: () => Promise.resolve(JSON.stringify(openaiShape)),
  };
}

function callOne(messages, { baseUrl, apiKey, model, maxTokens }, tools = null) {
  const isAnthropic = (baseUrl || '').includes('anthropic.com');
  if (isAnthropic) {
    return callAnthropic(messages, { apiKey, model, maxTokens }, tools);
  }
  const url = (baseUrl || '').replace(/\/$/, '') + '/chat/completions';
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
    ...(tools && tools.length > 0 ? { tools } : {}),
  };
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey && apiKey !== 'not-needed' && { Authorization: `Bearer ${apiKey}` }),
  };
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

/**
 * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} messages
 * @returns {Promise<string>}
 */
export async function chat(messages) {
  const { models } = loadConfig();
  let lastError;
  for (const opts of models) {
    const label = opts.model || opts.baseUrl?.replace(/^https?:\/\//, '').slice(0, 20) || 'unknown';
    try {
      const res = await callOne(messages, opts);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM request failed ${res.status}: ${text}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content == null) throw new Error('No content in LLM response');
      console.log('[LLM] used:', label);
      return content.trim();
    } catch (err) {
      console.log('[LLM] try failed:', label, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('No LLM configured');
}

/**
 * OpenAI-format tool: { type: "function", function: { name, description, parameters } }.
 * parameters is JSON Schema (e.g. { type: "object", properties: {...} }).
 *
 * @param {Array<{ role: string, content?: string, tool_calls?: Array<{ id: string, type: string, function: { name: string, arguments: string } }> }>} messages
 * @param {Array<{ type: 'function', function: { name: string, description: string, parameters: object } }>} tools - OpenAI tools array
 * @returns {Promise<{ content: string, toolCalls: Array<{ id: string, name: string, arguments: string }> }>}
 */
export async function chatWithTools(messages, tools) {
  const { models } = loadConfig();
  let lastError;
  for (const opts of models) {
    const label = opts.model || opts.baseUrl?.replace(/^https?:\/\//, '').slice(0, 20) || 'unknown';
    try {
      const res = await callOne(messages, opts, tools);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM request failed ${res.status}: ${text}`);
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('No message in LLM response');
      const content = (msg.content && String(msg.content).trim()) || '';
      const rawCalls = msg.tool_calls || [];
      const toolCalls = rawCalls.map((tc) => ({
        id: tc.id || '',
        name: tc.function?.name || '',
        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
      }));
      console.log('[LLM] used:', label, toolCalls.length ? `(${toolCalls.length} tool call(s))` : '');
      return { content, toolCalls };
    } catch (err) {
      console.log('[LLM] try failed:', label, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('No LLM configured');
}

/**
 * Classify user intent for routing. Identify first, then we decide reply behaviour.
 * Uses one short LLM call.
 * @param {string} userMessage
 * @returns {Promise<'CHAT'|'SCHEDULE_LIST'|'SCHEDULE_CREATE'>}
 */
const INTENT_TIMEOUT_MS = 15_000;

export async function classifyIntent(userMessage) {
  const messages = [
    {
      role: 'system',
      content: `You classify the user's intent. Reply with exactly one word: CHAT, SCHEDULE_LIST, SCHEDULE_CREATE, or SEARCH.

SEARCH = the user wants CURRENT, RECENT, or REAL-TIME information from the web. Examples: "recent AI trends", "latest news about X", "what's trending today", "search for X", "find me information about X", "what is the weather today", "current price of Y", "what happened this week". If they need up-to-date or live data = SEARCH.

SCHEDULE_LIST = the user ONLY wants to see, list, count, or ask about existing scheduled jobs/reminders/crons. Examples: "do we have any crons?", "which crons are set?", "list my reminders", "what's scheduled?".

SCHEDULE_CREATE = the user wants to CREATE or SET a new reminder or schedule. Examples: "remind me in 5 minutes", "send me X tomorrow", "set a cron for 8am".

CHAT = greetings, general knowledge questions (that don't need current data), or conversation. Examples: "Hi", "what is the capital of France", "explain quantum computing".`,
    },
    { role: 'user', content: (userMessage || '').trim() || 'Hi' },
  ];
  const { models } = loadConfig();
  let lastError;
  for (const opts of models) {
    const label = opts.model || opts.baseUrl?.replace(/^https?:\/\//, '').slice(0, 20) || 'unknown';
    try {
      const res = await Promise.race([
        callOne(messages, { ...opts, maxTokens: 25 }, null),
        new Promise((_, reject) => setTimeout(() => reject(new Error('intent timeout')), INTENT_TIMEOUT_MS)),
      ]);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM request failed ${res.status}: ${text}`);
      }
      const data = await res.json();
      const content = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
      if (content.includes('SCHEDULE_LIST')) return 'SCHEDULE_LIST';
      if (content.includes('SCHEDULE_CREATE')) return 'SCHEDULE_CREATE';
      if (content.includes('SCHEDULE')) return 'SCHEDULE_CREATE';
      if (content.includes('SEARCH')) return 'SEARCH';
      return 'CHAT';
    } catch (err) {
      console.log('[LLM] intent try failed:', label, err.message);
      lastError = err;
    }
  }
  if (lastError) return 'CHAT';
  throw new Error('No LLM configured');
}

export { loadConfig, PRESETS };
