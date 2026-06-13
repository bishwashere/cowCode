#!/usr/bin/env node
/**
 * Local LLM per-minute rate limiter tests.
 *
 * 1. With default 1 RPM: first request succeeds, second within the same window is rejected.
 * 2. With RPM=0 (unlimited): multiple requests all succeed.
 * 3. With RPM=2: two requests succeed, third is rejected.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTempStateDir } from './e2e-run.js';

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
}

function makeLocalFetch(label) {
  return async (url) => {
    const href = String(url);
    if (/127\.0\.0\.1/.test(href)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: label + ' ok' } }] }),
        text: async () => '',
      };
    }
    throw new Error('unexpected url: ' + href);
  };
}

function writeAgentConfig(stateDir, agentId, localRpm) {
  const dir = join(stateDir, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  const cfg = {
    llm: {
      maxTokens: 64,
      localRpm,
      models: [
        { provider: 'lmstudio', model: 'local', apiKey: 'not-needed', baseUrl: 'http://127.0.0.1:1234/v1' },
      ],
    },
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg), 'utf8');
}

async function testDefaultOnePm() {
  const stateDir = createTempStateDir();
  process.env.PASTURE_STATE_DIR = stateDir;
  writeAgentConfig(stateDir, 'rpm-agent1', 1);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeLocalFetch('local-rpm1');
  try {
    const { chat } = await import('../../llm.js?rpm-test-1');
    const reply = await chat([{ role: 'user', content: 'ping' }], { agentId: 'rpm-agent1' });
    assert(reply === 'local-rpm1 ok', 'first request should succeed, got: ' + reply);

    let threw = false;
    try {
      await chat([{ role: 'user', content: 'ping 2' }], { agentId: 'rpm-agent1' });
    } catch (err) {
      threw = true;
      assert(
        err.code === 'LLM_LOCAL_RATE_LIMIT' || /Local LLM rate limit reached/i.test(err.message),
        'expected LLM_LOCAL_RATE_LIMIT, got: ' + err.message,
      );
    }
    assert(threw, 'second request within window must throw LLM_LOCAL_RATE_LIMIT');
    console.log('test-llm-local-rpm [1/3 default-1rpm] passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testUnlimited() {
  const stateDir = createTempStateDir();
  process.env.PASTURE_STATE_DIR = stateDir;
  writeAgentConfig(stateDir, 'rpm-agent2', 0);

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (url) => {
    if (/127\.0\.0\.1/.test(String(url))) {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'unlimited ok ' + callCount } }] }),
        text: async () => '',
      };
    }
    throw new Error('unexpected url: ' + url);
  };
  try {
    const { chat } = await import('../../llm.js?rpm-test-2');
    for (let i = 0; i < 5; i++) {
      const r = await chat([{ role: 'user', content: 'ping ' + i }], { agentId: 'rpm-agent2' });
      assert(r.startsWith('unlimited ok'), 'expected success, got: ' + r);
    }
    assert(callCount === 5, 'expected 5 fetch calls, got: ' + callCount);
    console.log('test-llm-local-rpm [2/3 unlimited] passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRpm2() {
  const stateDir = createTempStateDir();
  process.env.PASTURE_STATE_DIR = stateDir;
  writeAgentConfig(stateDir, 'rpm-agent3', 2);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeLocalFetch('rpm2');
  try {
    const { chat } = await import('../../llm.js?rpm-test-3');
    await chat([{ role: 'user', content: 'ping 1' }], { agentId: 'rpm-agent3' });
    await chat([{ role: 'user', content: 'ping 2' }], { agentId: 'rpm-agent3' });
    let threw = false;
    try {
      await chat([{ role: 'user', content: 'ping 3' }], { agentId: 'rpm-agent3' });
    } catch (err) {
      threw = true;
      assert(
        err.code === 'LLM_LOCAL_RATE_LIMIT' || /Local LLM rate limit reached/i.test(err.message),
        'expected LLM_LOCAL_RATE_LIMIT on 3rd request, got: ' + err.message,
      );
    }
    assert(threw, 'third request in window must be rejected when RPM=2');
    console.log('test-llm-local-rpm [3/3 rpm=2] passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

testDefaultOnePm()
  .then(() => testUnlimited())
  .then(() => testRpm2())
  .then(() => {
    console.log('All test-llm-local-rpm tests passed.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
