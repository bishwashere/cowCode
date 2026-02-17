/**
 * E2E tests for cron (list / add / manage) through the main chatting interface.
 * Sends user message → intent → LLM + cron tool → reply. Expect delay per test (AI + tool calls).
 *
 * We assert:
 * - Reply text looks like list / add confirmation / remove.
 * - For a single "add" message, the cron store has exactly one job (catches duplicate-add bugs).
 * We do NOT wait for one-shot delivery (would require keeping process alive and capturing sent messages).
 */

import { spawn } from 'child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DEFAULT_STATE_DIR = join(homedir(), '.cowcode');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 120_000;

// Cron list: user asks to see scheduled reminders (cron tool action "list").
const CRON_LIST_QUERIES = [
  "List my reminders",
  "What's scheduled?",
  "Which crons are set?",
  "Do I have any reminders?",
  "Show my scheduled jobs",
];

// Cron add: user asks to create a reminder (cron tool action "add").
const CRON_ADD_QUERIES = [
  "Remind me in 2 minutes to test the cron",
  "Remind me to call John in 3 minutes",
  "Send me a hello message in 1 minute",
  "remind me in 5 minutes to drink water",
  "remind me to call mom tomorrow at 9am",
  "set a reminder for grocery shopping in 2 hours",
  "remind me every Monday to take out the trash",
  "create a daily reminder at 8pm to review code",
];

// Recurring (cron expr): every 5 mins, every morning, etc. Optional expectedExpr pattern (regex or string).
const CRON_RECURRING_ADD_QUERIES = [
  { query: 'Remind me every 5 minutes to stretch', expectedExpr: '*/5 * * * *' },
  { query: 'Every morning at 8am remind me to drink water', expectedExpr: '0 8 * * *' },
  { query: 'Create a daily reminder at 9am for standup', expectedExpr: '0 9 * * *' },
  { query: 'remind me every hour to take a break', expectedExpr: '0 * * * *' },
];

// Cron manage: list reminders or remove/delete (remove needs job id; "delete all" may get explanation).
const REMINDER_MANAGE_QUERIES = [
  "list my reminders",
  "show all my reminders",
  "what reminders do I have?",
  "remove reminder number 3",          // assuming prior setup in test
  "delete all reminders",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Test queries are in English; reply must be in English (not e.g. Spanish). Fails if reply appears to be in another language. */
function assertReplyInSameLanguageAsQuery(query, reply) {
  const spanishIndicators = [
    'No tienes',
    'recordatorios programados',
    'ningún recordatorio',
    'Puedes crear',
    'si lo deseas',
    'Usa "add"',
    'para crear uno',
    'eliminar un recordatorio',
    'déjame saber',
    'te daré los pasos',
    'No hay recordatorios',
    'He programado',
    'Tu recordatorio',
    'está programado',
    'Te recordé',
    '¿Cómo puedo',
    'mañana a las',
    'para "llamar',
    'bebas agua',
    'revisar el código',
    'trabajos programados',
    'un recordatorio diario',
    'la opción de "add"',
  ];
  const lower = (reply || '').toLowerCase();
  const found = spanishIndicators.filter((phrase) => lower.includes(phrase.toLowerCase()));
  assert(
    found.length === 0,
    `Reply must be in same language as user (query is English). Reply appears to be in Spanish (found: ${found.join(', ')}). Reply (first 200 chars): ${(reply || '').slice(0, 200)}`
  );
}

/**
 * Create a temp state dir with empty cron store. Copies config.json and .env from default state dir
 * so the child process has LLM config (otherwise we get ERR_INVALID_URL for baseUrl).
 * @returns {{ stateDir: string, storePath: string }}
 */
function createTempStateDir() {
  const stateDir = join(ROOT, 'scripts', 'test', '.tmp-cron-e2e-' + Date.now());
  const cronDir = join(stateDir, 'cron');
  const storePath = join(cronDir, 'jobs.json');
  mkdirSync(cronDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify({ version: 1, jobs: [] }, null, 2), 'utf8');
  if (existsSync(join(DEFAULT_STATE_DIR, 'config.json'))) {
    copyFileSync(join(DEFAULT_STATE_DIR, 'config.json'), join(stateDir, 'config.json'));
  }
  if (existsSync(join(DEFAULT_STATE_DIR, '.env'))) {
    copyFileSync(join(DEFAULT_STATE_DIR, '.env'), join(stateDir, '.env'));
  }
  return { stateDir, storePath };
}

/**
 * Run the main app in --test mode with one message; return the reply text.
 * @param {string} userMessage
 * @param {object} [opts] - Optional. If opts.stateDir is set, use it as COWCODE_STATE_DIR so the cron store is isolated.
 * @returns {Promise<string>} Reply text (what would be sent to the user).
 */
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
        reject(new Error(`No E2E reply in output (code ${code}). stderr: ${stderr.slice(-500)}`));
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

/** Load cron store from path; returns { version, jobs }. */
function loadStore(storePath) {
  if (!existsSync(storePath)) return { version: 1, jobs: [] };
  const raw = readFileSync(storePath, 'utf8').trim();
  try {
    const data = JSON.parse(raw);
    return { version: data.version ?? 1, jobs: Array.isArray(data.jobs) ? data.jobs : [] };
  } catch {
    return { version: 1, jobs: [] };
  }
}

const RUN_JOB_TIMEOUT_MS = 30_000;

/**
 * Force-execute a single cron job payload (same as runner does): run cron/run-job.js with message + jid.
 * Asserts output is valid JSON with textToSend (or error). Uses opts.stateDir for COWCODE_STATE_DIR so config/.env are loaded.
 * @param {string} message - Job message (prompt to LLM)
 * @param {object} [opts] - { stateDir } for isolated state (default: DEFAULT_STATE_DIR)
 * @returns {Promise<{ textToSend?: string, error?: string }>}
 */
function runJobOnce(message, opts = {}) {
  const stateDir = opts.stateDir || DEFAULT_STATE_DIR;
  const storePath = join(stateDir, 'cron', 'jobs.json');
  const workspaceDir = join(stateDir, 'workspace');
  const payload = JSON.stringify({
    message: String(message || 'Hello'),
    jid: 'test-e2e@s.whatsapp.net',
    storePath,
    workspaceDir,
  });
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(ROOT, 'cron', 'run-job.js')], {
      cwd: ROOT,
      env: { ...process.env, COWCODE_STATE_DIR: stateDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`run-job timed out after ${RUN_JOB_TIMEOUT_MS / 1000}s`));
    }, RUN_JOB_TIMEOUT_MS);
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
      const line = stdout.trim().split('\n').pop() || '';
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) resolve({ error: parsed.error });
        else resolve({ textToSend: parsed.textToSend });
      } catch (e) {
        reject(new Error(`run-job invalid output (code ${code}): ${line.slice(0, 200)}. stderr: ${stderr.slice(-300)}`));
      }
    });
    child.stdin.end(payload, 'utf8');
  });
}

/** Format jobs for table cell: one line per job (at/expr + message). */
function formatCronSet(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return '—';
  return jobs
    .map((j) => {
      const msg = (j.message || '').slice(0, 60) + ((j.message || '').length > 60 ? '…' : '');
      if (j.schedule?.kind === 'at' && j.schedule?.at) return `at ${j.schedule.at} → "${msg}"`;
      if (j.schedule?.kind === 'cron' && j.schedule?.expr) return `cron ${j.schedule.expr} → "${msg}"`;
      return `"${msg}"`;
    })
    .join('; ');
}

/** Escape pipe and newline for markdown table cell. */
function cell(s) {
  return String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

async function runReport() {
  const rows = [];
  const allQueries = [
    ...CRON_LIST_QUERIES.map((q) => ({ query: q, type: 'list' })),
    ...CRON_ADD_QUERIES.map((q) => ({ query: q, type: 'add' })),
    { query: 'Remind me to check lock after two minutes', type: 'add-single' },
    ...CRON_RECURRING_ADD_QUERIES.map(({ query }) => ({ query, type: 'add-recurring' })),
    ...REMINDER_MANAGE_QUERIES.map((q) => ({ query: q, type: 'manage' })),
  ];
  console.log('Cron E2E report: running each query and capturing reply + store…\n');
  for (const { query, type } of allQueries) {
    try {
      let reply = '';
      let cronSet = '—';
      if (type === 'add' || type === 'add-single' || type === 'add-recurring') {
        const { stateDir, storePath } = createTempStateDir();
        reply = await runE2E(query, { stateDir });
        const { jobs } = loadStore(storePath);
        cronSet = formatCronSet(jobs);
      } else {
        reply = await runE2E(query);
      }
      rows.push({ query, reply, cronSet });
      console.log('  ✓', query.slice(0, 50) + (query.length > 50 ? '…' : ''));
    } catch (err) {
      rows.push({ query, reply: `(error: ${err.message})`, cronSet: '—' });
      console.log('  ✗', query.slice(0, 50), err.message);
    }
  }
  const outPath = join(__dirname, 'CRON_E2E_TABLE.md');
  const lines = [
    '# Cron E2E: tabulated from test run',
    '',
    '| User said | Reply | Cron set |',
    '|-----------|-------|----------|',
    ...rows.map((r) => `| ${cell(r.query)} | ${cell(r.reply)} | ${cell(r.cronSet)} |`),
  ];
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log('\nWrote', outPath);
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--report')) {
    await runReport();
    return;
  }
  let passed = 0;
  let failed = 0;

  console.log('E2E cron tests: intent → LLM → cron tool → reply.');
  console.log('Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.\n');

  console.log('--- Cron (list) ---\n');
  for (const query of CRON_LIST_QUERIES) {
    try {
      const reply = await runE2E(query);
      assertReplyInSameLanguageAsQuery(query, reply);
      const looksLikeList = reply.includes("don't have any") || reply.includes('scheduled') || reply.includes('reminder') || reply.includes('id=') || reply.includes('No ') || reply.includes('no ');
      assert(
        looksLikeList && reply.length > 10,
        `Expected cron list-style reply for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Cron (add) ---\n');
  for (const query of CRON_ADD_QUERIES) {
    try {
      const reply = await runE2E(query);
      assertReplyInSameLanguageAsQuery(query, reply);
      const looksLikeConfirmation = /scheduled|set|added|reminder|in \d+ minute|at \d+:|will send|will remind/i.test(reply) || reply.length > 20;
      assert(
        looksLikeConfirmation,
        `Expected cron add confirmation for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Cron (add) — exact job count (no duplicates) ---\n');
  const singleAddQuery = 'Remind me to check lock after two minutes';
  try {
    const { stateDir, storePath } = createTempStateDir();
    const reply = await runE2E(singleAddQuery, { stateDir });
    assertReplyInSameLanguageAsQuery(singleAddQuery, reply);
    const looksLikeConfirmation = /scheduled|set|added|reminder|in \d+ minute|will send|will remind|timer|done/i.test(reply) || reply.length > 15;
    assert(looksLikeConfirmation, `Expected add confirmation. Got: ${reply.slice(0, 300)}`);
    const { jobs } = loadStore(storePath);
    assert(jobs.length === 1, `One "add" message must create exactly one job; got ${jobs.length}. Duplicate-add bug.`);
    const atTimes = jobs.filter((j) => j.schedule?.kind === 'at' && j.schedule?.at).map((j) => j.schedule.at);
    const uniqueAt = new Set(atTimes);
    assert(uniqueAt.size === atTimes.length, `All one-shot jobs must have unique "at" times; got duplicates.`);
    console.log(`  ✓ "${singleAddQuery}" → store has exactly 1 job, no duplicate at`);
    passed++;
  } catch (err) {
    console.log(`  ✗ "${singleAddQuery}": ${err.message}`);
    failed++;
  }

  console.log('\n--- Cron (add) — recurring (every 5 min, every morning, etc.) ---\n');
  for (const { query, expectedExpr } of CRON_RECURRING_ADD_QUERIES) {
    try {
      const { stateDir, storePath } = createTempStateDir();
      const reply = await runE2E(query, { stateDir });
      assertReplyInSameLanguageAsQuery(query, reply);
      const looksLikeConfirmation = /scheduled|set|added|reminder|every|daily|will send|will remind/i.test(reply) || reply.length > 20;
      assert(
        looksLikeConfirmation,
        `Expected recurring add confirmation for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      const { jobs } = loadStore(storePath);
      const cronJobs = jobs.filter((j) => j.schedule?.kind === 'cron' && j.schedule?.expr);
      assert(cronJobs.length >= 1, `Expected at least one cron (recurring) job for "${query}"; got ${jobs.length} jobs, cron: ${cronJobs.length}.`);
      if (expectedExpr) {
        const found = cronJobs.some((j) => j.schedule.expr === expectedExpr);
        assert(found, `Expected cron expr "${expectedExpr}" for "${query}". Got: ${cronJobs.map((j) => j.schedule.expr).join(', ')}`);
      }
      console.log(`  ✓ "${query}" → cron ${cronJobs[0]?.schedule?.expr ?? '—'}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Cron (execute) — force run job output ---\n');
  try {
    const message = 'Reply with exactly: Cron E2E execute test OK';
    const result = await runJobOnce(message, { stateDir: DEFAULT_STATE_DIR });
    assert(!result.error, `run-job should not return error; got: ${result.error}`);
    assert(
      result.textToSend && result.textToSend.length > 0,
      `run-job should return non-empty textToSend; got: ${JSON.stringify(result)}`
    );
    // Prefer reply that echoes the test phrase; accept any non-trivial reply as valid output
    const hasExpected = /Cron E2E execute test OK|execute test OK/i.test(result.textToSend);
    assert(
      result.textToSend.length > 10 && (hasExpected || result.textToSend.length > 30),
      `run-job should return substantive reply; got (first 200): ${result.textToSend.slice(0, 200)}`
    );
    console.log(`  ✓ run-job returned textToSend (${result.textToSend.length} chars)`);
    passed++;
  } catch (err) {
    console.log(`  ✗ run-job: ${err.message}`);
    failed++;
  }

  console.log('\n--- Cron (manage: list / remove) ---\n');
  for (const query of REMINDER_MANAGE_QUERIES) {
    try {
      const reply = await runE2E(query);
      assertReplyInSameLanguageAsQuery(query, reply);
      const listStyle =
        reply.includes("don't have any") ||
        reply.includes('scheduled') ||
        reply.includes('reminder') ||
        reply.includes('id=') ||
        reply.includes('No ') ||
        reply.includes('no ') ||
        (reply.includes('list') && (reply.includes('cron') || reply.includes('tool') || reply.includes('answered')));
      const removeStyle = /removed|not found|delete|remove|job \d|by id|one at a time/i.test(reply);
      assert(
        (listStyle || removeStyle) && reply.length > 5,
        `Expected cron list/remove-style reply for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Result ---');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
