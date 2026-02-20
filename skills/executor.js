/**
 * Central executor: runs tool operations (add, delete, list, etc.) with LLM-provided args.
 * No logic in skill folders; tool schemas come from tools.json + config.
 * When ctx.groupNonOwner is true (any message from a group), certain skills are not allowed for anyone in the group.
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

/** Skills that no one in a group can use (group-only restriction; private chats and DMs are not restricted). Exported for loader to hide from group tool list. */
export const SKILLS_NOT_ALLOWED_FOR_GROUP_NON_OWNER = new Set([
  'core', 'read', 'write', 'edit', 'apply-patch', 'browse', 'cron', 'gog',
]);

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
};

/** Core skill (shell commands) is disabled for everyone — not available. */
const CORE_SKILL_ID = 'core';

/**
 * @param {string} skillId - cron | search | memory
 * @param {object} ctx - storePath, jid, workspaceDir, scheduleOneShot, startCron
 * @param {object} args - Parsed LLM tool arguments
 * @param {string} [toolName] - For multi-tool skills (e.g. memory_search, memory_get)
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args, toolName) {
  if (skillId === CORE_SKILL_ID) {
    return JSON.stringify({ error: 'The core skill is not available.' });
  }
  if (ctx.groupNonOwner && SKILLS_NOT_ALLOWED_FOR_GROUP_NON_OWNER.has(skillId)) {
    return JSON.stringify({ error: 'This skill is not allowed for group members.' });
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
