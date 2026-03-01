/**
 * Shared E2E judge: a separate LLM call to decide whether the user got what they wanted.
 * See E2E.md for the testing model (we test the project's skill, not APIs/tokens).
 *
 * Usage:
 *   const { judgeUserGotWhatTheyWanted } = await import('./e2e-judge.js');
 *   const { pass, reason } = await judgeUserGotWhatTheyWanted(userMessage, botReply, stateDir, { prompt: customPrompt });
 *   or use default prompt with skillHint: 'cron' | 'browser' | 'memory' | 'home-assistant' | 'write' | 'edit' | 'me'
 */

import dotenv from 'dotenv';
import { getEnvPath } from '../../lib/paths.js';

/**
 * @param {string} userMessage - What the user asked.
 * @param {string} botReply - The reply the bot produced.
 * @param {string} stateDir - State dir for config/env (LLM API key etc.).
 * @param {{ prompt?: string, skillHint?: string }} [opts] - If prompt is set, use it. Else use skillHint to build a default prompt.
 * @returns {Promise<{ pass: boolean, reason?: string }>}
 */
export async function judgeUserGotWhatTheyWanted(userMessage, botReply, stateDir, opts = {}) {
  const prevStateDir = process.env.COWCODE_STATE_DIR;
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    dotenv.config({ path: getEnvPath() });
    const { chat } = await import('../../llm.js');
    const prompt =
      opts.prompt ||
      buildDefaultJudgePrompt(userMessage, botReply, opts.skillHint || 'skill');
    const response = await chat([{ role: 'user', content: prompt }]);
    const trimmed = (response || '').trim().toUpperCase();
    const pass = trimmed.startsWith('YES');
    return { pass, reason: (response || '').trim().slice(0, 600) };
  } finally {
    if (prevStateDir !== undefined) process.env.COWCODE_STATE_DIR = prevStateDir;
    else delete process.env.COWCODE_STATE_DIR;
  }
}

/**
 * @param {string} userMessage
 * @param {string} botReply
 * @param {string} skillHint - 'cron' | 'browser' | 'memory' | 'write' | 'edit' | 'me' | 'skill'
 */
function buildDefaultJudgePrompt(userMessage, botReply, skillHint) {
  const criteria = {
    cron:
      'For listing reminders: the reply should show a list or say there are no reminders. For adding a reminder: the reply should confirm it was scheduled. For removing: confirm removal or explain. Reply should be in the same language as the user (e.g. English).',
    browser:
      'For news/headlines: the reply should contain headlines, a summary, or current news. For search/navigate: the reply should address the query with relevant content. For non-news queries: the reply should not be only a generic news block.',
    memory:
      'The bot has access to memory. If the user asked to recall something from a previous message, the reply should reference or state what was stored. If the bot says it does not know or does not have that information, answer NO.',
    write:
      'For writing or creating a file: the reply should confirm the file was written, created, or saved (e.g. path, success). Refusing to write or an error without attempting the skill is NO.',
    edit:
      'For editing or replacing text in a file: the reply should confirm the edit was applied (e.g. replaced, updated). Refusing to edit or an error because the bot did not call the edit skill is NO.',
    me:
      'For "what do you know about me?" or profile: the reply should be a short profile, summary of notes/memory, or say there is little/no information. A friendly "I don\'t have much" or empty profile is YES. An error or refusing to use the me skill is NO.',
    skill:
      'The reply should address what the user asked in a helpful way. If the user asked for specific data (e.g. a list), the reply should contain that or a clear explanation (e.g. "no items"). Error messages or setup instructions alone are not "what they wanted" unless the user asked for help.',
  };
  const hint = criteria[skillHint] || criteria.skill;
  return `You are a test judge. The user asked:

"${userMessage}"

The bot replied:

---
${botReply}
---

Did the user GET WHAT THEY WANTED? ${hint}

Answer with exactly one line: YES or NO. Then add one short sentence explaining why.`;
}
