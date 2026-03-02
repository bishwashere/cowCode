/**
 * E2E tests for the me skill through the main chatting interface.
 * See scripts/test/E2E.md. Flow: user message → LLM → me skill → reply → judge.
 * Uses a temp state dir (empty or with MEMORY.md); judge accepts profile or "little/no info".
 */

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';
import { runSkillTests } from './skill-test-runner.js';
import { judgeUserGotWhatTheyWanted } from './e2e-judge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DEFAULT_STATE_DIR = process.env.COWCODE_STATE_DIR || join(homedir(), '.cowcode');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 120_000;

const ME_QUERIES = [
  'What do you know about me?',
  'Summarize what you know about me',
  'What have you learned about me?',
  'Tell me about myself',
];

function createTempStateDir(withMemory = false) {
  const stateDir = join(tmpdir(), 'cowcode-me-e2e-' + Date.now());
  const workspaceDir = join(stateDir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  if (withMemory) {
    writeFileSync(join(workspaceDir, 'MEMORY.md'), 'User prefers E2E tests. Mentioned on test run.\n', 'utf8');
  }
  if (existsSync(join(DEFAULT_STATE_DIR, 'config.json'))) {
    copyFileSync(join(DEFAULT_STATE_DIR, 'config.json'), join(stateDir, 'config.json'));
  }
  if (existsSync(join(DEFAULT_STATE_DIR, '.env'))) {
    copyFileSync(join(DEFAULT_STATE_DIR, '.env'), join(stateDir, '.env'));
  }
  return stateDir;
}

function runE2E(userMessage, opts = {}) {
  const env = { ...process.env };
  if (opts.stateDir) env.COWCODE_STATE_DIR = opts.stateDir;
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['index.js', '--test', userMessage], {
      cwd: ROOT,
      env,
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
        reject(new Error(`No E2E reply (code ${code}). stderr: ${stderr.slice(-500)}`));
        return;
      }
      const reply = stdout
        .slice(startIdx + E2E_REPLY_MARKER_START.length, endIdx)
        .replace(/^\n+|\n+$/g, '')
        .trim();
      if (code !== 0) {
        reject(new Error(`Process exited ${code}. Reply: ${reply.slice(0, 200)}`));
        return;
      }
      resolve(reply);
    });
  });
}

async function main() {
  console.log('E2E tests: me skill (user message → LLM → me → reply → judge).');
  console.log('Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.\n');

  const stateDirEmpty = createTempStateDir(false);
  const stateDirWithMemory = createTempStateDir(true);

  const REPLY_PREVIEW_LEN = 400;
  const tests = [
    ...ME_QUERIES.slice(0, 2).map((query) => ({
      name: `me (empty): "${query}"`,
      run: async () => {
        const reply = await runE2E(query, { stateDir: stateDirEmpty });
        const { pass, reason } = await judgeUserGotWhatTheyWanted(query, reply, stateDirEmpty, { skillHint: 'me' });
        console.log(`  Reply: ${(reply || '').slice(0, REPLY_PREVIEW_LEN)}${(reply || '').length > REPLY_PREVIEW_LEN ? '…' : ''}`);
        if (reason) console.log(`  Judge: ${reason.trim().slice(0, 200)}`);
        if (!pass) throw new Error(`Judge: ${reason || 'NO'}. Reply (first 400): ${(reply || '').slice(0, 400)}`);
      },
    })),
    ...ME_QUERIES.slice(2, 4).map((query) => ({
      name: `me (with MEMORY): "${query}"`,
      run: async () => {
        const reply = await runE2E(query, { stateDir: stateDirWithMemory });
        const { pass, reason } = await judgeUserGotWhatTheyWanted(query, reply, stateDirWithMemory, { skillHint: 'me' });
        console.log(`  Reply: ${(reply || '').slice(0, REPLY_PREVIEW_LEN)}${(reply || '').length > REPLY_PREVIEW_LEN ? '…' : ''}`);
        if (reason) console.log(`  Judge: ${reason.trim().slice(0, 200)}`);
        if (!pass) throw new Error(`Judge: ${reason || 'NO'}. Reply (first 400): ${(reply || '').slice(0, 400)}`);
      },
    })),
  ];

  const { failed } = await runSkillTests('me', tests);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
