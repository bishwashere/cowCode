/**
 * Cron runner. Schedules jobs from the store; when due, runs LLM and sends reply to WhatsApp.
 */

import { Cron } from 'croner';
import { chat as llmChat } from '../llm.js';
import { loadJobs, removeJob, updateJob } from './store.js';

function stripThinking(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

/** @type {import('croner').Cron[]} */
const scheduled = [];
/** @type {NodeJS.Timeout[]} */
const oneShotTimeouts = [];
/** Set by startCron so scheduleOneShot can use them */
let currentSock = null;
let currentSelfJid = null;
let currentStorePath = null;

/**
 * Run a single cron job: call LLM with job.message, send result to job.jid (or selfJid).
 * @param {Object} opts
 * @param {import('./store.js').CronJob} opts.job
 * @param {object} opts.sock - Baileys socket
 * @param {string} opts.selfJid - Fallback JID when job.jid is not set
 */
async function runJob({ job, sock, selfJid }) {
  const jid = job.jid || selfJid;
  if (!jid) {
    console.error('[cron] No JID for job', job.id, job.name);
    return;
  }
  console.log('[cron] Running job:', job.name, '→', jid);
  try {
    const rawReply = await llmChat([
      { role: 'system', content: 'You are a helpful assistant. Reply concisely. Do not use <think> or any thinking/reasoning blocks—output only your final reply.' },
      { role: 'user', content: job.message },
    ]);
    const reply = stripThinking(rawReply);
    if (reply) {
      await sock.sendMessage(jid, { text: '[CowCode] ' + reply });
      console.log('[cron] Sent:', job.name);
    }
  } catch (err) {
    console.error('[cron] Job failed:', job.name, err.message);
    try {
      await sock.sendMessage(jid, { text: `[CowCode] Moo — reminder "${job.name}" didn't go through: ${err.message}` });
    } catch (_) {}
  }
}

/**
 * Start the cron runner: load jobs and schedule each enabled cron job and future one-shots.
 * Call this once WhatsApp is connected (so sock and selfJid are valid).
 *
 * @param {Object} opts
 * @param {object} opts.sock - Baileys socket (sendMessage)
 * @param {string} opts.selfJid - Your WhatsApp JID (e.g. 1234567890@s.whatsapp.net) for "message yourself"
 * @param {string} [opts.storePath] - Path to cron/jobs.json
 */
export function startCron({ sock, selfJid, storePath }) {
  currentSock = sock;
  currentSelfJid = selfJid;
  currentStorePath = storePath || null;

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
