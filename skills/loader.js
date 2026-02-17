/**
 * Load skill docs for the LLM. No registry — we only need to pass skill.md content
 * and the run_skill tool; the LLM decides what to call.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getConfigPath } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default skill ids enabled on new install and added by migration on update. */
export const DEFAULT_ENABLED = ['cron', 'search', 'browse', 'vision', 'memory', 'gog'];

const SKILL_JSON = 'skill.json';
const MD_NAMES = ['skill.md', 'SKILL.md'];

function getSkillMdPath(skillId) {
  for (const name of MD_NAMES) {
    const p = join(__dirname, skillId, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export function getSkillsEnabled() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills;
    if (!skills || typeof skills !== 'object') return DEFAULT_ENABLED;
    return Array.isArray(skills.enabled) ? skills.enabled : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

/**
 * Load skill folders (skill.json + skill.md) for enabled ids. Return docs string and one run_skill tool.
 * No branching: one tool, LLM fills skill + arguments from the prompts. Code stays dumb.
 * @returns {{ skillDocs: string, runSkillTool: Array }}
 */
export function getSkillContext() {
  const enabled = getSkillsEnabled();
  const parts = [];
  const available = [];

  for (const id of enabled) {
    const jsonPath = join(__dirname, id, SKILL_JSON);
    if (!existsSync(jsonPath)) continue;
    try {
      JSON.parse(readFileSync(jsonPath, 'utf8'));
      available.push(id);
      const mdPath = getSkillMdPath(id);
      if (mdPath) {
        const skillMd = readFileSync(mdPath, 'utf8').trim();
        parts.push(`## Skill: ${id}\n\n${skillMd}`);
      }
    } catch (_) {}
  }

  const skillDocs = parts.length ? parts.join('\n\n---\n\n') : '';
  const runSkillTool =
    available.length === 0
      ? []
      : [
          {
            type: 'function',
            function: {
              name: 'run_skill',
              description: 'Run one of the available skills. The command name is the operation: set "command" to the operation name (e.g. search, navigate, list, add, remove) or set "arguments.action" to the same. Set "skill" and "arguments" as described in each skill.',
              parameters: {
                type: 'object',
                properties: {
                  skill: {
                    type: 'string',
                    enum: available,
                    description: 'Skill id (cron, search, browse, vision, memory, gog).',
                  },
                  command: {
                    type: 'string',
                    description: 'Command name for the operation (name is command). e.g. search: search, navigate; browse: navigate, click, scroll, fill, screenshot, reset; vision: describe; cron: list, add, remove. If set, this is the operation to run; otherwise use arguments.action.',
                  },
                  arguments: {
                    type: 'object',
                    description: 'Skill-specific arguments. See skill docs. When command is set, it overrides arguments.action.',
                    additionalProperties: true,
                  },
                },
                required: ['skill', 'arguments'],
              },
            },
          },
        ];

  return { skillDocs, runSkillTool };
}
