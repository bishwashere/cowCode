/**
 * Cron skill: schedule reminders (add), list jobs, remove job.
 * Uses cron/store and cron/runner; normalizes job input for robustness.
 */

import { addJob, loadJobs, removeJob } from '../cron/store.js';

const CRON_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['add', 'list', 'remove'],
      description: 'list = show/count scheduled jobs (use for "how many crons?", "what is the next cron?", "list reminders"). add = create a new reminder (only when user asks to set one). remove = delete a job by id.',
    },
    job: {
      type: 'object',
      description: 'Required for add. Must have "message" (text to send) and "schedule" (when). Schedule: { "kind": "at", "at": "ISO8601" } for one-shot, or { "kind": "cron", "expr": "0 8 * * *", "tz": "America/New_York" } for recurring.',
      properties: {
        message: { type: 'string', description: 'Exact text the user asked to be sent (do not invent or paraphrase)' },
        schedule: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['at', 'cron'], description: 'at = one time at ISO8601, cron = recurring' },
            at: { type: 'string', description: 'ISO 8601 timestamp for one-shot (e.g. from Date.toISOString())' },
            expr: { type: 'string', description: 'Cron expression, e.g. "0 8 * * *" for 8am daily' },
            tz: { type: 'string', description: 'IANA timezone for cron, e.g. America/New_York' },
          },
        },
        name: { type: 'string', description: 'Optional label for the job' },
      },
    },
    jobId: { type: 'string', description: 'Required for remove. Job id from list.' },
  },
  required: ['action'],
};

function parseAbsoluteTimeMs(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const rawKind = (schedule.kind && String(schedule.kind).trim().toLowerCase()) || '';
  const atRaw = schedule.at;
  const atString = typeof atRaw === 'string' ? atRaw.trim() : '';
  const parsedMs = atString ? parseAbsoluteTimeMs(atString) : null;
  const kind = rawKind === 'at' || rawKind === 'cron' ? rawKind : (schedule.expr ? 'cron' : atString ? 'at' : null);
  if (!kind) return null;
  const next = { kind };
  if (kind === 'at') {
    next.at = parsedMs != null ? new Date(parsedMs).toISOString() : atString || undefined;
  }
  if (kind === 'cron') {
    if (schedule.expr && String(schedule.expr).trim()) next.expr = String(schedule.expr).trim();
    if (schedule.tz && String(schedule.tz).trim()) next.tz = String(schedule.tz).trim();
  }
  return next;
}

function normalizeJobAdd(raw, jid) {
  const job = typeof raw === 'object' && raw !== null ? raw : {};
  const message = (job.message && String(job.message).trim()) || (job.text && String(job.text).trim()) || 'Reminder';
  const schedule = coerceSchedule(job.schedule);
  if (!schedule) throw new Error('job.schedule required (e.g. { "kind": "at", "at": "<ISO8601>" } or { "kind": "cron", "expr": "0 8 * * *" })');
  const name = (job.name && String(job.name).trim()) || 'Reminder';
  return {
    name,
    enabled: true,
    schedule,
    message,
    jid: jid || null,
  };
}

function formatJobList(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (list.length === 0) return "You don't have any scheduled jobs. Use action add to create one.";
  const lines = list.map((j, i) => {
    let when = '';
    if (j.schedule?.kind === 'at' && j.schedule?.at) {
      try {
        when = new Date(j.schedule.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      } catch {
        when = j.schedule.at;
      }
    } else if (j.schedule?.kind === 'cron' && j.schedule?.expr) {
      when = `cron ${j.schedule.expr}` + (j.schedule.tz ? ` (${j.schedule.tz})` : '');
    } else when = 'scheduled';
    const msg = (j.message || '').slice(0, 40) + ((j.message || '').length > 40 ? '…' : '');
    return `${i + 1}. id=${j.id} — ${when} — "${msg}"`;
  });
  return `Scheduled jobs (${list.length}):\n${lines.join('\n')}`;
}

export const cronSkill = {
  id: 'cron',
  name: 'cron',
  description: `Manage reminders and scheduled messages.

ACTIONS (choose one):
- list: Use for any query about existing jobs: "how many crons?", "which crons are set?", "what is the next cron?", "list my reminders", "what's scheduled?". For these, call only list (once). Do NOT also call add.
- add: Only when the user explicitly asks to CREATE/SET a new reminder. Requires "job" with "message" and "schedule". For "in 5 minutes" or "tomorrow 8am" use schedule.kind "at" with "at" as future ISO 8601. For recurring use kind "cron" with "expr" (e.g. "0 8 * * *") and optional "tz".
- remove: Delete a job. Requires "jobId" from list.

When the user asks for multiple new reminders (e.g. "remind me X in 1 min and Y in 2 min"), call add twice with different message and at. For "every one minute for the next three minutes" call add THREE times. Never invent reminder text: job.message must be exactly what the user asked to receive.`,
  parameters: CRON_TOOL_SCHEMA,
  async execute(ctx, args) {
    const { storePath, jid, scheduleOneShot, startCron } = ctx;
    const action = args?.action && String(args.action).trim().toLowerCase();
    if (!action) throw new Error('action required (add, list, remove)');

    if (action === 'list') {
      const jobs = loadJobs(storePath);
      return formatJobList(jobs);
    }

    if (action === 'remove') {
      const jobId = args.jobId && String(args.jobId).trim();
      if (!jobId) throw new Error('jobId required for remove');
      const removed = removeJob(jobId, storePath);
      return removed ? `Removed job ${jobId}.` : `Job ${jobId} not found.`;
    }

    if (action === 'add') {
      const input = normalizeJobAdd(args.job, jid);
      if (input.schedule?.kind === 'at' && input.schedule?.at) {
        const atMs = new Date(input.schedule.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= Date.now()) {
          throw new Error('One-shot "at" time must be in the future. Use a future ISO 8601 timestamp (e.g. now + 5 minutes).');
        }
      }
      const job = addJob(input, storePath);
      if (job.schedule?.kind === 'at') scheduleOneShot(job);
      // Do not call startCron() here: it would clear all timeouts and re-schedule from store (duplicate logs). We already scheduled this job.
      const when = job.schedule?.kind === 'at' && job.schedule?.at
        ? new Date(job.schedule.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
        : job.schedule?.expr || 'scheduled';
      return `Scheduled: "${(job.message || '').slice(0, 50)}${(job.message || '').length > 50 ? '…' : ''}" at ${when}.`;
    }

    throw new Error(`Unknown action: ${action}`);
  },
};
