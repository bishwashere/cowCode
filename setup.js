#!/usr/bin/env node
/**
 * One-command setup: install deps, one-time onboarding (base URL, optional API keys), then run the app.
 * On first run the app will show QR to link WhatsApp, then start the bot.
 * Usage: npm run setup | pnpm run setup | yarn setup | node setup.js
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

const C = { reset: '\x1b[0m', cyan: '\x1b[36m' };
/** Color the main question label so all prompts look consistent. */
function q(label) {
  return C.cyan + label + C.reset;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

function checkQuit(answer) {
  if (answer && answer.toLowerCase() === 'q') {
    console.log('Quit.');
    process.exit(0);
  }
}

/** Prompt with full default value shown (e.g. for base URL). Press q to quit. */
async function promptWithDefault(prompt, defaultVal) {
  const def = defaultVal ? ` [${defaultVal}]` : '';
  const answer = await ask(`${prompt}${def} (q to quit): `);
  checkQuit(answer);
  return answer || defaultVal || '';
}

/** Mask a secret for display: e.g. "sk-proj-Qx4ue..." -> "sk-proj-Qx***" */
function maskSecret(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (s.length <= 8) return '***';
  return s.slice(0, 12) + '***';
}

/** Prompt for a secret; if already set, show masked hint. Press q to quit. */
async function promptSecret(prompt, existingVal) {
  const display = existingVal ? maskSecret(existingVal) : '';
  const def = display ? ` [${display}]` : '';
  const answer = await ask(`${prompt}${def} (q to quit): `);
  checkQuit(answer);
  return answer || existingVal || '';
}

/** Returns first available package manager: pnpm, npm, or yarn. */
function getPackageManager() {
  for (const cmd of ['pnpm', 'npm', 'yarn']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout && String(r.stdout).trim().length > 0) return cmd;
  }
  return 'npm';
}

function ensureInstall() {
  const nodeModules = join(ROOT, 'node_modules');
  if (!existsSync(nodeModules) || !existsSync(join(nodeModules, '@whiskeysockets', 'baileys'))) {
    const pm = getPackageManager();
    console.log(`Installing dependencies (${pm} install)…`);
    const res = spawnSync(pm, ['install'], { cwd: ROOT, stdio: 'inherit' });
    if (res.status !== 0) {
      console.error(`${pm} install failed.`);
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

  const baseUrl = await promptWithDefault(q('Local LLM base URL (e.g. LM Studio)'), defaultBaseUrl || '');

  // Cloud LLM: ask provider directly, with skip
  let llm1Key = env.LLM_1_API_KEY || '';
  let llm2Key = env.LLM_2_API_KEY || '';
  let llm3Key = env.LLM_3_API_KEY || '';

  let provider;
  try {
    const select = (await import('@inquirer/select')).default;
    provider = await select({
      message: q('Cloud LLM provider?'),
      choices: [
        { name: 'OpenAI', value: 'openai' },
        { name: 'Grok', value: 'grok' },
        { name: 'Anthropic', value: 'anthropic' },
        { name: 'Skip', value: 'skip' },
        { name: 'Quit', value: 'quit' },
      ],
    });
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const answer = await ask(q('Cloud LLM provider?') + ' (openai / grok / anthropic / skip, q to quit): ');
      checkQuit(answer);
      provider = (answer || '').trim().toLowerCase() || 'skip';
    } else {
      throw err;
    }
  }
  if (provider === 'quit') {
    console.log('Quit.');
    process.exit(0);
  }
  if (provider === 'openai') {
    llm1Key = await promptSecret(q('OpenAI API key'), env.LLM_1_API_KEY || '');
  } else if (provider === 'grok') {
    llm2Key = await promptSecret(q('Grok API key'), env.LLM_2_API_KEY || '');
  } else if (provider === 'anthropic') {
    llm3Key = await promptSecret(q('Anthropic API key'), env.LLM_3_API_KEY || '');
  }

  const braveKey = await promptSecret(q('Brave Search API key – optional'), env.BRAVE_API_KEY || '');

  if (baseUrl && config?.llm?.models?.[0]) {
    config.llm.models[0].baseUrl = baseUrl;
    saveConfig(config);
  }

  const newEnv = { ...env };
  newEnv.LLM_1_API_KEY = llm1Key ?? '';
  newEnv.LLM_2_API_KEY = llm2Key ?? '';
  newEnv.LLM_3_API_KEY = llm3Key ?? '';
  newEnv.BRAVE_API_KEY = braveKey ?? '';

  writeFileSync(ENV_PATH, stringifyEnv(newEnv), 'utf8');
  console.log('\nConfig and .env updated. Starting the app…\n');
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('Setup needs an interactive terminal.');
    console.log('Run: cd cowCode && node setup.js');
    console.log('Or: cd cowCode && npm install && npm start\n');
    process.exit(0);
  }
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
