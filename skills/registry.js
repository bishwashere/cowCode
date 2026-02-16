/**
 * Skill registry: loads config, exposes enabled skills as OpenAI-format tools and executors.
 * config.json skills.enabled lists which skills are on (default: ["cron"]).
 * Other skills (e.g. search) can be added to config and to this registry when implemented.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getConfigPath } from '../lib/paths.js';
import { cronSkill } from './cron.js';
import { browserSkill } from './browser.js';
import { memorySkill } from './memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ENABLED = ['cron', 'browser'];

/** Built-in skills. Add new skills here and to config.json skills.enabled when ready. */
const BUILTIN_SKILLS = {
  cron: cronSkill,
  browser: browserSkill,
  memory: memorySkill,
};

/** Map tool name (from LLM) to skill id. For multi-tool skills (e.g. memory_search, memory_get -> memory). */
const TOOL_NAME_TO_SKILL_ID = {
  memory_search: 'memory',
  memory_get: 'memory',
};

/**
 * @returns {{ enabled: string[], [key: string]: unknown }}
 */
export function getSkillsConfig() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills;
    if (!skills || typeof skills !== 'object') {
      return { enabled: DEFAULT_ENABLED };
    }
    const enabled = Array.isArray(skills.enabled) ? skills.enabled : DEFAULT_ENABLED;
    return { enabled, ...skills };
  } catch {
    return { enabled: ['cron'] };
  }
}

/**
 * Returns OpenAI-format tools array for enabled skills only.
 * Skills with a .tools array contribute multiple tools; otherwise one tool per skill.
 * @returns {Array<{ type: 'function', function: { name: string, description: string, parameters: object } }>}
 */
export function getEnabledTools() {
  const { enabled } = getSkillsConfig();
  const tools = [];
  for (const id of enabled) {
    const skill = BUILTIN_SKILLS[id];
    if (!skill) {
      console.warn('[skills] Unknown skill in config:', id);
      continue;
    }
    if (Array.isArray(skill.tools) && skill.tools.length > 0) {
      for (const t of skill.tools) {
        tools.push({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        });
      }
    } else {
      tools.push({
        type: 'function',
        function: {
          name: skill.name,
          description: skill.description,
          parameters: skill.parameters,
        },
      });
    }
  }
  return tools;
}

/**
 * Resolve skill id from tool name (for dispatch when executing).
 * @param {string} toolName - e.g. "cron", "browser", "memory_search", "memory_get"
 * @returns {string} skill id, e.g. "cron", "browser", "memory"
 */
export function getSkillIdForToolName(toolName) {
  if (TOOL_NAME_TO_SKILL_ID[toolName]) return TOOL_NAME_TO_SKILL_ID[toolName];
  return toolName;
}

/**
 * Execute a skill by id. Returns string result for the LLM.
 * @param {string} skillId - e.g. "cron", "memory"
 * @param {object} ctx - Context (storePath, jid, scheduleOneShot, startCron, workspaceDir, etc.)
 * @param {object} args - Parsed arguments from the LLM tool call
 * @param {string} [toolName] - Tool name when skill has multiple tools (e.g. "memory_search", "memory_get")
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args, toolName) {
  const skill = BUILTIN_SKILLS[skillId];
  if (!skill) return JSON.stringify({ error: `Unknown skill: ${skillId}` });
  try {
    const result = await skill.execute(ctx, args, toolName || skill.name);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[skills]', skillId, err.message);
    return JSON.stringify({ error: err.message });
  }
}
