/**
 * Central executor: runs tool operations (add, delete, list, etc.) with LLM-provided args.
 * No logic in skill folders; tool schemas come from tools.json + config.
 * Skill availability is determined only by config (main or per-group); no extra group restrictions.
 */

import { executeCron } from '../lib/executors/cron.js';
import { executeBrowser } from '../lib/executors/browser.js';
import { executeBrowse } from '../lib/executors/browse.js';
import { executeMemory } from '../lib/executors/memory.js';
import { executeVision } from '../lib/executors/vision.js';
import { executeGog } from '../lib/executors/gog.js';
import { executeRead } from '../lib/executors/read.js';
import { executeWrite } from '../lib/executors/write.js';
import { executeEdit } from '../lib/executors/edit.js';
import { executeApplyPatch } from '../lib/executors/apply-patch.js';
import { executeCore } from '../lib/executors/core.js';
import { executeSpeech } from '../lib/executors/speech.js';
import { executeHomeAssistant } from '../lib/executors/home-assistant.js';
import { executeMe } from '../lib/executors/me.js';

const EXECUTORS = {
  cron: executeCron,
  search: executeBrowser,
  browse: executeBrowse,
  vision: executeVision,
  memory: executeMemory,
  speech: executeSpeech,
  gog: executeGog,
  read: executeRead,
  write: executeWrite,
  edit: executeEdit,
  'apply-patch': executeApplyPatch,
  core: executeCore,
  'home-assistant': executeHomeAssistant,
  me: executeMe,
};

/** Core skill (shell commands) is disabled in group chats only; allowed in DMs and dashboard. */
const CORE_SKILL_ID = 'core';

/**
 * @param {string} skillId - cron | search | memory
 * @param {object} ctx - storePath, jid, workspaceDir, scheduleOneShot, startCron, isGroup
 * @param {object} args - Parsed LLM tool arguments
 * @param {string} [toolName] - For multi-tool skills (e.g. memory_search, memory_get)
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args, toolName) {
  if (skillId === CORE_SKILL_ID && ctx?.isGroup) {
    return JSON.stringify({ error: 'The core skill is not available in group chats.' });
  }
  const run = EXECUTORS[skillId];
  if (!run) return JSON.stringify({ error: `Unknown skill: ${skillId}` });
  try {
    if (skillId === 'memory') {
      const result = await executeMemory(ctx, args, toolName || 'memory_search');
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    const result = await run(ctx, args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[skills]', skillId, err.message);
    return JSON.stringify({ error: err.message });
  }
}
