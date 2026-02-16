/**
 * Skill registry: folder-per-skill discovery. Scans skills/ for subdirs with index.js,
 * loads each skill and optional SKILL.md, exposes enabled tools and executors.
 * config.json skills.enabled lists which skills are on.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { getConfigPath } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ENABLED = ['cron', 'browser', 'memory'];

/** Populated by loadSkills(). Map skill id -> skill module. */
let SKILLS_CACHE = {};
/** Map tool name -> skill id (for multi-tool skills). */
let TOOL_NAME_TO_SKILL_ID_CACHE = {};

/**
 * Discover skill ids by scanning skills/ for subdirs that contain index.js.
 * @returns {string[]}
 */
function discoverSkillIds() {
  const ids = [];
  try {
    const entries = readdirSync(__dirname, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const indexPath = join(__dirname, e.name, 'index.js');
      if (existsSync(indexPath)) ids.push(e.name);
    }
  } catch (err) {
    console.error('[skills] discovery failed:', err.message);
  }
  return ids.sort();
}

/**
 * Load SKILL.md for a skill if present (from skills/<id>/SKILL.md).
 * @param {string} skillId
 * @returns {string | null}
 */
function loadSkillMd(skillId) {
  const mdPath = join(__dirname, skillId, 'SKILL.md');
  if (!existsSync(mdPath)) return null;
  try {
    return readFileSync(mdPath, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the skill export from a loaded module (default or <id>Skill camelCase).
 * @param {object} mod - Module namespace
 * @param {string} id - Skill id (e.g. cron, browser, memory)
 * @returns {object | null}
 */
function getSkillFromModule(mod, id) {
  if (mod?.default && typeof mod.default === 'object' && mod.default.id) return mod.default;
  const camel = id.slice(0, 1).toLowerCase() + id.slice(1) + 'Skill';
  if (mod[camel]) return mod[camel];
  const pascal = id.charAt(0).toUpperCase() + id.slice(1) + 'Skill';
  if (mod[pascal]) return mod[pascal];
  if (mod[id]) return mod[id];
  return null;
}

/**
 * Load all skills from the filesystem. Call once at startup before using getEnabledTools/executeSkill.
 * @returns {Promise<void>}
 */
export async function loadSkills() {
  const ids = discoverSkillIds();
  const skills = {};
  const toolToSkill = {};

  for (const id of ids) {
    try {
      const indexPath = join(__dirname, id, 'index.js');
      const mod = await import(pathToFileURL(indexPath).href);
      const skill = getSkillFromModule(mod, id);
      if (!skill || !skill.id) {
        console.warn('[skills] Skipping', id, ': no skill export (expected default or', id + 'Skill, with .id)');
        continue;
      }
      const skillId = skill.id;
      const md = loadSkillMd(id);
      if (md) skill.skillMd = md;
      skills[skillId] = skill;
      if (Array.isArray(skill.tools) && skill.tools.length > 0) {
        for (const t of skill.tools) toolToSkill[t.name] = skillId;
      } else if (skill.name) {
        toolToSkill[skill.name] = skillId;
      }
    } catch (err) {
      console.error('[skills] Failed to load', id, ':', err.message);
    }
  }

  SKILLS_CACHE = skills;
  TOOL_NAME_TO_SKILL_ID_CACHE = toolToSkill;
}

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
    return { enabled: DEFAULT_ENABLED };
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
    const skill = SKILLS_CACHE[id];
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
 * @param {string} toolName
 * @returns {string}
 */
export function getSkillIdForToolName(toolName) {
  if (TOOL_NAME_TO_SKILL_ID_CACHE[toolName]) return TOOL_NAME_TO_SKILL_ID_CACHE[toolName];
  return toolName;
}

/**
 * @param {string} skillId
 * @param {object} ctx
 * @param {object} args
 * @param {string} [toolName]
 * @returns {Promise<string>}
 */
export async function executeSkill(skillId, ctx, args, toolName) {
  const skill = SKILLS_CACHE[skillId];
  if (!skill) return JSON.stringify({ error: `Unknown skill: ${skillId}` });
  try {
    const result = await skill.execute(ctx, args, toolName || skill.name);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[skills]', skillId, err.message);
    return JSON.stringify({ error: err.message });
  }
}
