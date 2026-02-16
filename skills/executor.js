/**
 * Central executor: runs tool operations (add, delete, list, etc.) with LLM-provided args.
 * No logic in skill folders; tool schemas come from tools.json + config.
 */

import { executeCron } from '../lib/executors/cron.js';
import { executeBrowser } from '../lib/executors/browser.js';
import { executeMemory } from '../lib/executors/memory.js';

const EXECUTORS = {
  cron: executeCron,
  search: executeBrowser,
  memory: executeMemory,
};

/**
 * @param {string} skillId - cron | search | memory
 * @param {object} ctx - storePath, jid, workspaceDir, scheduleOneShot, startCron
 * @param {object} args - Parsed LLM tool arguments
 * @param {string} [toolName] - For multi-tool skills (e.g. memory_search, memory_get)
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args, toolName) {
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
