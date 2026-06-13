#!/usr/bin/env node
/**
 * Cloud daily limit must not block local model fallback (alex-style config: cloud priority + local).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTempStateDir } from './e2e-run.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const stateDir = createTempStateDir();
  process.env.PASTURE_STATE_DIR = stateDir;
  process.env.LLM_1_API_KEY = 'sk-test-cloud-key';

  mkdirSync(join(stateDir, 'agents', 'alex'), { recursive: true });
  writeFileSync(
    join(stateDir, 'agents', 'alex', 'config.json'),
    JSON.stringify({
      llm: {
        maxTokens: 256,
        models: [
          {
            provider: 'lmstudio',
            model: 'local',
            apiKey: 'not-needed',
            baseUrl: 'http://127.0.0.1:1234/v1',
          },
          {
            provider: 'openai',
            model: 'gpt-5.2',
            apiKey: 'LLM_1_API_KEY',
            priority: true,
          },
        ],
      },
    }),
    'utf8',
  );

  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(stateDir, 'llm-usage.json'),
    JSON.stringify({ date: today, count: 100 }),
    'utf8',
  );

  const originalFetch = globalThis.fetch;
  let cloudAttempted = false;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.openai.com')) {
      cloudAttempted = true;
      throw new Error('cloud fetch should not run when daily limit is reached');
    }
    if (href.includes('127.0.0.1:1234')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'local fallback ok' } }],
        }),
        text: async () => '',
      };
    }
    throw new Error(`unexpected fetch url: ${href}`);
  };

  try {
    const { chat } = await import('../../llm.js');
    const reply = await chat(
      [{ role: 'user', content: 'ping' }],
      { agentId: 'alex' },
    );
    assert(cloudAttempted === false, 'cloud model must not be called after daily limit');
    assert(reply === 'local fallback ok', `expected local fallback, got: ${reply}`);
    console.log('test-llm-daily-limit passed');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LLM_1_API_KEY;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
