#!/usr/bin/env node
/**
 * One-command setup: install deps, one-time onboarding (base URL, optional API keys), then run the app.
 * On first run the app will show QR to link WhatsApp, then start the bot.
 * Usage: pnpm run setup
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { spawnSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const CONFIG_PATH = join(ROOT, 'config.json');
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/** Prompt with full default value shown (e.g. for base URL). */
async function promptWithDefault(prompt, defaultVal) {
  const def = defaultVal ? ` [${defaultVal}]` : '';
  const answer = await ask(`${prompt}${def}: `);
  return answer || defaultVal || '';
}

/** Mask a secret for display: e.g. "sk-proj-Qx4ue..." -> "sk-proj-Qx***" */
function maskSecret(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (s.length <= 8) return '***';
  return s.slice(0, 12) + '***';
}

/** Prompt for a secret; if already set, show masked hint (e.g. sk-proj-Qx***) and keep value on Enter. */
async function promptSecret(prompt, existingVal) {
  const display = existingVal ? maskSecret(existingVal) : '';
  const def = display ? ` [${display}]` : '';
  const answer = await ask(`${prompt}${def}: `);
  return answer || existingVal || '';
}

function ensureInstall() {
  const nodeModules = join(ROOT, 'node_modules');
  const pkgPath = join(ROOT, 'package.json');
  if (!existsSync(nodeModules) || !existsSync(join(nodeModules, '@whiskeysockets', 'baileys'))) {
    console.log('Installing dependencies (pnpm install)…');
    const res = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (res.status !== 0) {
      console.error('pnpm install failed.');
      process.exit(res.status ?? 1);
    }
    console.log('Dependencies installed.\n');
  }
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getDefaultBaseUrl(config) {
  const first = config?.llm?.models?.[0];
  if (first?.baseUrl) return first.baseUrl;
  return 'http://127.0.0.1:1234/v1';
}

function parseEnv(content) {
  const lines = (content || '').split('\n');
  const out = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key && !key.startsWith('#')) out[key] = val;
  }
  return out;
}

function stringifyEnv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

async function onboarding() {
  const config = loadConfig();
  const defaultBaseUrl = getDefaultBaseUrl(config);
  const hasEnv = existsSync(ENV_PATH);
  const envContent = hasEnv ? readFileSync(ENV_PATH, 'utf8') : '';
  const env = parseEnv(envContent);

  console.log('\n--- One-time setup (optional: press Enter to keep defaults or skip) ---\n');

  const baseUrl = await promptWithDefault('Local LLM base URL (e.g. LM Studio)', defaultBaseUrl || '');
  const llmKey = await promptSecret('LLM API key (e.g. OpenAI) – optional', env.LLM_1_API_KEY || '');
  const braveKey = await promptSecret('Brave Search API key – optional', env.BRAVE_API_KEY || '');

  if (baseUrl && config?.llm?.models?.[0]) {
    config.llm.models[0].baseUrl = baseUrl;
    saveConfig(config);
  }

  const newEnv = { ...env };
  if (llmKey !== undefined) newEnv.LLM_1_API_KEY = llmKey;
  if (braveKey !== undefined) newEnv.BRAVE_API_KEY = braveKey;
  if (!newEnv.LLM_1_API_KEY) newEnv.LLM_1_API_KEY = '';
  if (!newEnv.BRAVE_API_KEY) newEnv.BRAVE_API_KEY = '';

  writeFileSync(ENV_PATH, stringifyEnv(newEnv), 'utf8');
  console.log('\nConfig and .env updated. Starting the app…\n');
}

async function main() {
  console.log('cowCode setup – install, configure, then run.\n');
  ensureInstall();
  await onboarding();

  console.log('Starting WhatsApp bot (scan QR if first time, then the bot runs).\n');
  const child = spawn('node', ['index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  });
  child.on('close', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
