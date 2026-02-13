/**
 * Skill registry: loads config, exposes enabled skills as OpenAI-format tools and executors.
 * config.json skills.enabled lists which skills are on (default: ["cron"]).
 * Other skills (e.g. search) can be added to config and to this registry when implemented.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cronSkill } from './cron.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = join(__dirname, '..', 'config.json');

/** Built-in skills. Add new skills here and to config.json skills.enabled when ready. */
const BUILTIN_SKILLS = {
  cron: cronSkill,
  // search: searchSkill,  // future
};

/**
 * @returns {{ enabled: string[], [key: string]: unknown }}
 */
export function getSkillsConfig() {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills;
    if (!skills || typeof skills !== 'object') {
      return { enabled: ['cron'] };
    }
    const enabled = Array.isArray(skills.enabled) ? skills.enabled : ['cron'];
    return { enabled, ...skills };
  } catch {
    return { enabled: ['cron'] };
  }
}

/**
 * Returns OpenAI-format tools array for enabled skills only.
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
    tools.push({
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      },
    });
  }
  return tools;
}

/**
 * Execute a skill by id. Returns string result for the LLM.
 * @param {string} skillId - e.g. "cron"
 * @param {object} ctx - Context (storePath, jid, scheduleOneShot, startCron, etc.)
 * @param {object} args - Parsed arguments from the LLM tool call
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args) {
  const skill = BUILTIN_SKILLS[skillId];
  if (!skill) return JSON.stringify({ error: `Unknown skill: ${skillId}` });
  try {
    const result = await skill.execute(ctx, args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[skills]', skillId, err.message);
    return JSON.stringify({ error: err.message });
  }
}
