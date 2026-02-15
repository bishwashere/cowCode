#!/usr/bin/env node
/**
 * One-command setup: install deps, one-time onboarding (base URL, optional API keys), then run the app.
 * On first run the app will show QR to link WhatsApp, then start the bot.
 * Usage: npm run setup | pnpm run setup | yarn setup | node setup.js
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { spawnSync, spawn } from 'child_process';
import { getConfigPath, getEnvPath, getAuthDir, getCronStorePath, ensureStateDir } from './lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const ENV_EXAMPLE = join(ROOT, '.env.example');

const C = { reset: '\x1b[0m', cyan: '\x1b[36m', dim: '\x1b[2m', green: '\x1b[32m', bold: '\x1b[1m' };
/** Color the main question label so all prompts look consistent. */
function q(label) {
  return C.cyan + label + C.reset;
}
function section(title) {
  console.log('');
  console.log(C.dim + '  ─────────────────────────────────────────' + C.reset);
  console.log(C.dim + '  ' + title + C.reset);
  console.log(C.dim + '  ─────────────────────────────────────────' + C.reset);
  console.log('');
}
function welcome() {
  console.log('');
  console.log(C.green + '  Welcome to cowCode' + C.reset);
  console.log(C.dim + '  WhatsApp bot powered by your own LLM (local or cloud)' + C.reset);
  console.log('');
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

function migrateFromRoot() {
  ensureStateDir();
  const stateConfig = getConfigPath();
  const stateEnv = getEnvPath();
  const stateAuth = getAuthDir();
  const stateCron = getCronStorePath();
  const rootConfig = join(ROOT, 'config.json');
  const rootEnv = join(ROOT, '.env');
  const rootAuth = join(ROOT, 'auth_info');
  const rootCron = join(ROOT, 'cron', 'jobs.json');
  if (existsSync(rootConfig) && !existsSync(stateConfig)) {
    copyFileSync(rootConfig, stateConfig);
    console.log(C.dim + '  ✓ Migrated config.json to ~/.cowcode' + C.reset);
  }
  if (existsSync(rootEnv) && !existsSync(stateEnv)) {
    copyFileSync(rootEnv, stateEnv);
    console.log(C.dim + '  ✓ Migrated .env to ~/.cowcode' + C.reset);
  }
  if (existsSync(rootAuth)) {
    const creds = join(rootAuth, 'creds.json');
    if (existsSync(creds) && !existsSync(join(stateAuth, 'creds.json'))) {
      cpSync(rootAuth, stateAuth, { recursive: true });
      console.log(C.dim + '  ✓ Migrated auth_info to ~/.cowcode' + C.reset);
    }
  }
  if (existsSync(rootCron) && !existsSync(stateCron)) {
    mkdirSync(dirname(stateCron), { recursive: true });
    copyFileSync(rootCron, stateCron);
    console.log(C.dim + '  ✓ Migrated cron/jobs.json to ~/.cowcode' + C.reset);
  }
}

function ensureInstall() {
  const nodeModules = join(ROOT, 'node_modules');
  if (!existsSync(nodeModules) || !existsSync(join(nodeModules, '@whiskeysockets', 'baileys'))) {
    const pm = getPackageManager();
    section('Installing dependencies');
    console.log('  Running: ' + pm + ' install');
    console.log('');
    const res = spawnSync(pm, ['install'], { cwd: ROOT, stdio: 'inherit' });
    if (res.status !== 0) {
      console.error('  ' + pm + ' install failed.');
      process.exit(res.status ?? 1);
    }
    console.log('');
    console.log(C.dim + '  ✓ Dependencies ready.' + C.reset);
  }
}

function loadConfig() {
  if (!existsSync(getConfigPath())) return null;
  try {
    return JSON.parse(readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
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
  const envPath = getEnvPath();
  const hasEnv = existsSync(envPath);
  const envContent = hasEnv ? readFileSync(envPath, 'utf8') : '';
  const env = parseEnv(envContent);

  section('Configuration (optional — press Enter to keep defaults or skip)');

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
        { name: 'Skip', value: 'skip' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Grok', value: 'grok' },
        { name: 'Anthropic', value: 'anthropic' },
        { name: 'Quit', value: 'quit' },
      ],
    });
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const answer = await ask(q('Cloud LLM provider?') + ' (skip / openai / grok / anthropic, q to quit): ');
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

  writeFileSync(getEnvPath(), stringifyEnv(newEnv), 'utf8');

  // When user adds a cloud LLM key during setup, set that model as priority — but only if no model
  // has priority yet (so we never overwrite a choice the user made later in config).
  const cloudKeyAdded = provider !== 'skip' && (
    (provider === 'openai' && (llm1Key ?? '').trim()) ||
    (provider === 'grok' && (llm2Key ?? '').trim()) ||
    (provider === 'anthropic' && (llm3Key ?? '').trim())
  );
  if (cloudKeyAdded && Array.isArray(config?.llm?.models)) {
    const models = config.llm.models;
    const hasPriorityAlready = models.some(
      (m) => m.priority === true || m.priority === 1 || String(m.priority).toLowerCase() === 'true'
    );
    if (!hasPriorityAlready) {
      for (let i = 0; i < models.length; i++) {
        const p = (models[i].provider || '').toLowerCase();
        models[i].priority = p === provider;
      }
      saveConfig(config);
    }
  }

  console.log('');
  console.log(C.dim + '  ✓ Config and .env saved to ~/.cowcode' + C.reset);
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('Setup needs an interactive terminal.');
    console.log('Run: cd cowCode && node setup.js');
    console.log('Or: cd cowCode && npm install && npm start\n');
    process.exit(0);
  }
  welcome();
  migrateFromRoot();
  ensureInstall();
  await onboarding();

  section('Starting cowCode');
  console.log('  If this is your first time, you’ll see a QR code — scan it with WhatsApp.');
  console.log('  Then send a message to your own number to start chatting.');
  console.log('');
  const child = spawn('node', ['index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  });
  child.on('close', (code) => {
    console.log('');
    console.log('  ------------------------------------------------');
    console.log('  To start the bot:  cowcode moo start');
    console.log('  (or from this folder:  npm start)');
    console.log('');
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
