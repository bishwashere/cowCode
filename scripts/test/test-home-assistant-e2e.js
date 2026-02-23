/**
 * E2E test for the Home Assistant skill: validates that our skill is accurate.
 * See scripts/test/E2E.md for what we test (project skill, not API/token).
 *
 * Flow: user message → main app LLM → home-assistant skill (CLI layer: ha-cli.js, env load, real fetch) → reply
 *       → separate LLM judge: did the user get what they wanted?
 *
 * - LLM chooses the home-assistant skill for "list my lights" / "what lights do I have"
 * - Skill runs via the HA CLI (skills/home-assistant/ha-cli.js); CLI loads HA_URL/HA_TOKEN from state dir .env
 * - CLI performs the real HA API call and returns the list to the user
 * No mocks: uses your real config and real Home Assistant. If HA is not configured or unreachable, the test fails.
 *
 * Prerequisites: home-assistant in skills.enabled, HA_URL/HA_TOKEN in ~/.cowcode/.env, HA reachable.
 * Run: node scripts/test/test-home-assistant-e2e.js
 * Or:  pnpm run test:home-assistant-e2e
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import dotenv from 'dotenv';
import { runSkillTests } from './skill-test-runner.js';
import { getEnvPath } from '../../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const INSTALL_ROOT = process.env.COWCODE_INSTALL_DIR ? resolve(process.env.COWCODE_INSTALL_DIR) : ROOT;
const DEFAULT_STATE_DIR = process.env.COWCODE_STATE_DIR || join(homedir(), '.cowcode');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 90_000;

/** Ensure real config has home-assistant enabled; throw with clear message if not. */
function ensureHomeAssistantEnabled() {
  const configPath = join(DEFAULT_STATE_DIR, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`No config at ${configPath}. Add home-assistant to skills.enabled and set HA_URL/HA_TOKEN in .env.`);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid config at ${configPath}: ${e && e.message}`);
  }
  const enabled = Array.isArray(config.skills?.enabled) ? config.skills.enabled : [];
  if (!enabled.includes('home-assistant')) {
    throw new Error(
      `home-assistant is not in skills.enabled at ${configPath}. Add "home-assistant" to config.skills.enabled and re-run.`
    );
  }
}

function runE2E(userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(INSTALL_ROOT, 'index.js'), '--test', userMessage], {
      cwd: INSTALL_ROOT,
      env: { ...process.env, COWCODE_STATE_DIR: DEFAULT_STATE_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`E2E run timed out after ${PER_TEST_TIMEOUT_MS / 1000}s`));
    }, PER_TEST_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const startIdx = stdout.indexOf(E2E_REPLY_MARKER_START);
      const endIdx = stdout.indexOf(E2E_REPLY_MARKER_END);
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        reject(new Error(`No E2E reply in output (code ${code}). stderr: ${stderr.slice(-400)}`));
        return;
      }
      const reply = stdout
        .slice(startIdx + E2E_REPLY_MARKER_START.length, endIdx)
        .replace(/^\n+|\n+$/g, '')
        .trim();
      resolve({ code, reply, stderr });
    });
  });
}

/**
 * Ask an LLM (separately from the system under test) whether the user got what they wanted.
 * Pass only if the reply actually fulfills the request (e.g. lists lights), not just "acceptable" or helpful error text.
 * @param {string} userMessage - What the user asked (e.g. "list my lights").
 * @param {string} botReply - The reply the bot produced.
 * @param {string} stateDir - State dir for config/env (LLM API key etc.).
 * @returns {Promise<{ pass: boolean, reason?: string }>}
 */
async function judgeUserGotWhatTheyWanted(userMessage, botReply, stateDir) {
  const prevStateDir = process.env.COWCODE_STATE_DIR;
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    dotenv.config({ path: getEnvPath() });
    const { chat } = await import('../../llm.js');
    const judgePrompt = `You are a test judge. A user asked the assistant:

"${userMessage}"

The assistant replied:

---
${botReply}
---
Did the user GET WHAT THEY WANTED? Requirements:
- For "list my lights" or "what lights do I have": the reply must contain an actual list of light entities (e.g. light.living_room, light.bedroom) or a clear statement that there are no lights. A reply that only says "I can't reach Home Assistant" or explains how to fix config is NOT giving the user what they wanted.
- If the assistant could not reach Home Assistant and therefore could not list lights, the user did NOT get what they wanted. Do not pass.
- Only answer YES if the reply actually fulfills the request (real list of lights, or explicit no lights after a successful query). Answer NO if the reply is just an error explanation or setup instructions.

Answer with exactly one line: YES or NO. Then add one short sentence explaining why.`;
    const response = await chat([
      { role: 'user', content: judgePrompt },
    ]);
    const trimmed = (response || '').trim().toUpperCase();
    const pass = trimmed.startsWith('YES');
    return { pass, reason: (response || '').trim().slice(0, 600) };
  } finally {
    if (prevStateDir !== undefined) process.env.COWCODE_STATE_DIR = prevStateDir;
    else delete process.env.COWCODE_STATE_DIR;
  }
}

async function main() {
  ensureHomeAssistantEnabled();

  const tests = [
    {
      name: 'List my lights — LLM judge: user got what they wanted',
      run: async () => {
        const userMessage = 'list my lights';
        const { reply } = await runE2E(userMessage);
        console.log('  Input:  ', userMessage);
        console.log('  Output: ', reply ? reply.split('\n').join('\n           ') : '(empty)');
        const { pass, reason } = await judgeUserGotWhatTheyWanted(userMessage, reply, DEFAULT_STATE_DIR);
        if (!pass) {
          throw new Error(`Judge: user did not get what they wanted. ${reason || 'NO'}. Bot reply (first 400 chars): ${(reply || '').slice(0, 400)}`);
        }
      },
    },
    {
      name: 'What lights do I have — LLM judge: user got what they wanted',
      run: async () => {
        const userMessage = 'What lights do I have?';
        const { reply } = await runE2E(userMessage);
        console.log('  Input:  ', userMessage);
        console.log('  Output: ', reply ? reply.split('\n').join('\n           ') : '(empty)');
        const { pass, reason } = await judgeUserGotWhatTheyWanted(userMessage, reply, DEFAULT_STATE_DIR);
        if (!pass) {
          throw new Error(`Judge: user did not get what they wanted. ${reason || 'NO'}. Bot reply (first 400 chars): ${(reply || '').slice(0, 400)}`);
        }
      },
    },
  ];

  const { passed, failed } = await runSkillTests('home-assistant', tests, {
    timeoutPerTest: PER_TEST_TIMEOUT_MS,
    installRoot: INSTALL_ROOT,
  });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
