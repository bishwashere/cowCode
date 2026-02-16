/**
 * Cron runner. Schedules jobs from the store; when due, runs the same agent (tools + LLM) as chat and sends reply.
 */

import { Cron } from 'croner';
import { loadJobs, removeJob, updateJob } from './store.js';
import { isTelegramChatId } from '../lib/telegram.js';
import { getTimezoneContextLine } from '../lib/timezone.js';
import { getCronStorePath, getWorkspaceDir } from '../lib/paths.js';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn, CLARIFICATION_RULE } from '../lib/agent.js';

/** @type {import('croner').Cron[]} */
const scheduled = [];
/** @type {NodeJS.Timeout[]} */
const oneShotTimeouts = [];
/** Set by startCron so scheduleOneShot can use them */
let currentSock = null;
/** Optional Telegram bot for jobs whose jid is a Telegram chat id */
let currentTelegramBot = null;
let currentSelfJid = null;
let currentStorePath = null;

/**
 * Send a text to jid (WhatsApp JID or Telegram chat id). Uses currentSock or currentTelegramBot.
 */
async function sendCronReply(jid, text) {
  if (currentTelegramBot && isTelegramChatId(jid)) {
    await currentTelegramBot.sendMessage(jid, text);
  } else if (currentSock && typeof currentSock.sendMessage === 'function') {
    await currentSock.sendMessage(jid, { text });
  } else {
    throw new Error('No transport to send cron reply');
  }
}

const MAX_RETRIES = 2; // retry on failure only twice (1 initial + 2 retries = 3 attempts)
const RETRY_DELAYS_MS = [5000, 15000]; // exponential backoff: 5s, then 15s

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build system prompt for cron runs: same skills as chat so the LLM can call search, cron, memory.
 */
function buildCronSystemPrompt(skillDocs, runSkillTool) {
  const base = `You are CowCode. Reply concisely. Use run_skill when you need search, cron, or memory. Do not use <think> or any thinking/reasoning blocks—output only your final reply.\n\n${getTimezoneContextLine()}`;
  const tools = Array.isArray(runSkillTool) && runSkillTool.length > 0;
  const skillBlock = tools && skillDocs
    ? `\n\n# Available skills (use run_skill with skill and arguments)\n\n${skillDocs}\n\n# Clarification\n${CLARIFICATION_RULE}`
    : '';
  return base + skillBlock;
}

/**
 * Run a single cron job: same agent as chat (LLM can call run_skill for search, cron, memory). Throws on failure.
 * @param {Object} opts
 * @param {import('./store.js').CronJob} opts.job
 * @param {object} opts.sock - Baileys socket (used when job.jid is WhatsApp)
 * @param {string} opts.selfJid - Fallback JID when job.jid is not set
 */
async function runJobOnce({ job, sock, selfJid }) {
  const jid = job.jid || selfJid;
  if (!jid) throw new Error('No JID for job');
  const { skillDocs, runSkillTool } = getSkillContext();
  const toolsToUse = Array.isArray(runSkillTool) && runSkillTool.length > 0 ? runSkillTool : [];
  const ctx = {
    storePath: currentStorePath || getCronStorePath(),
    jid,
    workspaceDir: getWorkspaceDir(),
    scheduleOneShot,
    startCron: () => startCron({ sock: currentSock, selfJid: currentSelfJid, storePath: currentStorePath, telegramBot: currentTelegramBot }),
  };
  const { textToSend } = await runAgentTurn({
    userText: job.message,
    ctx,
    systemPrompt: buildCronSystemPrompt(skillDocs, runSkillTool),
    tools: toolsToUse,
    historyMessages: [],
  });
  const text = isTelegramChatId(jid) ? textToSend.replace(/^\[CowCode\]\s*/i, '').trim() : textToSend;
  if (text) await sendCronReply(jid, text);
}

/**
 * Run a cron job with up to 2 retries on failure (exponential backoff: 5s, 15s).
 * @param {Object} opts - same as runJobOnce
 */
async function runJob({ job, sock, selfJid }) {
  const jid = job.jid || selfJid;
  if (!jid) {
    console.error('[cron] No JID for job', job.id, job.name);
    return;
  }
  console.log('[cron] Running job:', job.name, '→', jid);
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runJobOnce({ job, sock, selfJid });
      if (attempt > 0) console.log('[cron] Sent after retry:', job.name);
      else console.log('[cron] Sent:', job.name);
      return;
    } catch (err) {
      lastErr = err;
      console.error('[cron] Job failed' + (attempt < MAX_RETRIES ? ` (attempt ${attempt + 1}/${MAX_RETRIES + 1})` : ''), job.name, err.message);
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        console.log('[cron] Retrying in', Math.round(delayMs / 1000), 's');
        await sleep(delayMs);
      }
    }
  }
  try {
    await sendCronReply(jid, `[CowCode] Moo — reminder "${job.name}" didn't go through: ${lastErr?.message || 'Unknown error'}`);
  } catch (_) {}
}

/**
 * Start the cron runner: load jobs and schedule each enabled cron job and future one-shots.
 * Call this once WhatsApp is connected (so sock and selfJid are valid).
 * Optional telegramBot: reminders created from Telegram (job.jid = chat id) are sent via Telegram.
 *
 * @param {Object} opts
 * @param {object} opts.sock - Baileys socket (sendMessage). Not overwritten when agent passes a Telegram sock.
 * @param {string} opts.selfJid - Your WhatsApp JID for fallback when job.jid is missing
 * @param {string} [opts.storePath] - Path to cron/jobs.json
 * @param {import('node-telegram-bot-api')} [opts.telegramBot] - Optional Telegram bot for Telegram chat ids
 */
export function startCron({ sock, selfJid, storePath, telegramBot }) {
  if (sock != null && sock.user?.id !== 'telegram') {
    currentSock = sock;
  }
  if (telegramBot !== undefined) {
    currentTelegramBot = telegramBot || null;
  }
  if (selfJid != null) currentSelfJid = selfJid;
  if (storePath != null) currentStorePath = storePath;

  // Clear any previous schedules
  for (const c of scheduled) c.stop();
  scheduled.length = 0;
  for (const t of oneShotTimeouts) clearTimeout(t);
  oneShotTimeouts.length = 0;

  const jobs = loadJobs(storePath);
  const now = Date.now();

  const cronJobs = jobs.filter((j) => j.enabled && j.schedule?.kind === 'cron' && j.schedule?.expr);
  for (const job of cronJobs) {
    const expr = job.schedule.expr;
    const tz = job.schedule.tz || undefined;
    const cron = new Cron(expr, { timezone: tz }, async () => {
      await runJob({ job, sock, selfJid });
    });
    scheduled.push(cron);
    console.log('[cron] Scheduled:', job.name, expr, tz || '(local)');
  }

  const atJobs = jobs.filter((j) => j.enabled && j.schedule?.kind === 'at' && j.schedule?.at);
  for (const job of atJobs) {
    if (job.sentAtMs) continue; // Already sent (e.g. process died after send, before remove)
    const atMs = new Date(job.schedule.at).getTime();
    if (atMs > now) {
      scheduleOneShot(job);
    } else {
      // Due or overdue: mark sent first so restart never re-sends (even if we die after send, before remove)
      console.log('[cron] Running overdue one-shot:', job.name);
      updateJob(job.id, { sentAtMs: Date.now() }, storePath);
      runJob({ job, sock, selfJid }).then(() => removeJob(job.id, storePath));
    }
  }

  if (cronJobs.length === 0 && atJobs.length === 0) {
    console.log('[cron] No scheduled jobs in store. Add jobs via CLI or say e.g. "send me hi in 1 minute".');
  }
}

/**
 * Schedule a one-shot job to run at job.schedule.at. Uses current sock/selfJid/storePath from startCron.
 * Call this after addJob() when creating a job from chat (e.g. "send me X in N minutes").
 * @param {import('./store.js').CronJob} job - Job with schedule.kind === 'at'
 */
export function scheduleOneShot(job) {
  if (job.schedule?.kind !== 'at' || !job.schedule.at || !currentSock || !currentStorePath) return;
  if (job.sentAtMs) return; // Already sent
  const atMs = new Date(job.schedule.at).getTime();
  const ms = atMs - Date.now();
  if (ms <= 0) return;
  const id = setTimeout(async () => {
    updateJob(job.id, { sentAtMs: Date.now() }, currentStorePath); // Mark sent before run so restart never re-sends
    await runJob({ job, sock: currentSock, selfJid: currentSelfJid });
    removeJob(job.id, currentStorePath);
    console.log('[cron] One-shot completed and removed from store:', job.name, '(message was sent by cron, not the chat LLM)');
  }, ms);
  oneShotTimeouts.push(id);
  console.log('[cron] One-shot scheduled:', job.name, 'in', Math.round(ms / 1000), 's');
}

/**
 * Stop all scheduled cron jobs and one-shots (e.g. on disconnect).
 */
export function stopCron() {
  for (const c of scheduled) c.stop();
  scheduled.length = 0;
  for (const t of oneShotTimeouts) clearTimeout(t);
  oneShotTimeouts.length = 0;
}
