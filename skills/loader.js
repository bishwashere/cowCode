/**
 * Load skill docs for the LLM. Injects a compact list (name + description) per run;
 * when a skill is called, the executor runs it with full context.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getConfigPath } from '../lib/paths.js';
import { getGroupSkillsEnabled } from '../lib/group-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default skill ids enabled on new install and added by migration on update. */
export const DEFAULT_ENABLED = ['cron', 'search', 'browse', 'vision', 'memory', 'speech', 'gog', 'read', 'me', 'go-read', 'go-write'];

const MD_NAMES = ['skill.md', 'SKILL.md'];
const COMPACT_DESC_MAX = 280;

function getSkillMdPath(skillId) {
  for (const name of MD_NAMES) {
    const p = join(__dirname, skillId, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Parse SKILL.md for compact metadata. Compatible with skills that follow the compact format:
 * YAML frontmatter with at least description: ; optional id: and name: (see skills/SKILL_FORMAT.md).
 * @param {string} skillMd - Raw file content
 * @param {string} skillId - Skill id (folder name)
 * @returns {{ name: string, description: string }} name = display label (frontmatter name or id, else skillId); description = one-line summary
 */
function parseCompactFromSkillMd(skillMd, skillId) {
  const match = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = match ? match[1] : '';
  const getFront = (key) => {
    const line = block.split('\n').find((l) => new RegExp('^' + key + '\\s*:', 'i').test(l));
    if (!line) return null;
    const value = line.replace(new RegExp('^' + key + '\\s*:\\s*', 'i'), '').trim();
    return value.replace(/^["']|["']$/g, '').trim() || null;
  };
  const desc = getFront('description');
  const name = getFront('name') || getFront('id') || skillId;
  const description = desc || (() => {
    const afterFront = skillMd.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
    const firstLine = afterFront.split('\n')[0] || '';
    return firstLine.replace(/^#+\s*/, '').trim() || skillId;
  })();
  const short = description.length > COMPACT_DESC_MAX ? description.slice(0, COMPACT_DESC_MAX - 3) + '...' : description;
  return { name, description: short };
}

export function getSkillsEnabled() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills;
    if (!skills || typeof skills !== 'object') return DEFAULT_ENABLED;
    let list = Array.isArray(skills.enabled) ? skills.enabled : DEFAULT_ENABLED;
    if (list.includes('core')) {
      list = list.filter((id) => id !== 'core').concat('go-read', 'go-write');
    }
    return list;
  } catch {
    return DEFAULT_ENABLED;
  }
}

/**
 * Load skill folders (SKILL.md with optional YAML front matter). Returns compact list for prompt and one run_skill tool.
 * Called on every run so the list is fresh (config/skill changes picked up on next message).
 * When a skill is called, full doc for that skill can be injected via getFullSkillDoc(skillId).
 * @param {{ groupNonOwner?: boolean, groupJid?: string }} [options] - When groupNonOwner true, use group config; groupJid = that group's id for per-group skills.
 * @returns {{ compactList: string, runSkillTool: Array, getFullSkillDoc: (skillId: string) => string }}
 */
export function getSkillContext(options = {}) {
  const { groupNonOwner = false, groupJid } = options;
  const enabled = groupNonOwner ? getGroupSkillsEnabled(groupJid) : getSkillsEnabled();
  const idsToLoad = enabled;
  const compactEntries = [];
  const fullDocsById = Object.create(null);
  const available = [];

  for (const id of idsToLoad) {
    const mdPath = getSkillMdPath(id);
    if (!mdPath) continue;
    try {
      const skillMd = readFileSync(mdPath, 'utf8').trim();
      if (!skillMd) continue;
      available.push(id);
      const compact = parseCompactFromSkillMd(skillMd, id);
      compactEntries.push(`- **${id}**: ${compact.description}`);
      fullDocsById[id] = `## Skill: ${id}\n\n${skillMd}`;
    } catch (_) {}
  }

  const compactList =
    compactEntries.length > 0
      ? 'Available skills (use run_skill with skill and arguments; set "command" or "arguments.action" to the operation):\n\n' +
        compactEntries.join('\n')
      : '';
  const runSkillIntro =
    'Run a skill. Choose "skill" and "arguments" from the compact list below. Set "command" or "arguments.action" to the operation (e.g. search, list, add). When you call run_skill for a skill, you will receive full doc for that skill in the tool result if needed.';
  const runSkillTool =
    available.length === 0
      ? []
      : [
          {
            type: 'function',
            function: {
              name: 'run_skill',
              description: compactList ? runSkillIntro + '\n\n' + compactList : runSkillIntro,
              parameters: {
                type: 'object',
                properties: {
                  skill: {
                    type: 'string',
                    enum: available,
                    description: 'Skill id from the list above.',
                  },
                  command: {
                    type: 'string',
                    description: 'Operation name. e.g. cron: list, add, remove; search: search, navigate; browse: navigate, click, scroll, fill, screenshot, reset; vision: describe, generate. Use arguments.action if not set.',
                  },
                  arguments: {
                    type: 'object',
                    description: 'Skill-specific arguments. See full skill doc when you call a skill.',
                    additionalProperties: true,
                  },
                },
                required: ['skill', 'arguments'],
              },
            },
          },
        ];

  function getFullSkillDoc(skillId) {
    return fullDocsById[skillId] || '';
  }

  const skillDocs = available.length > 0 ? available.map((id) => fullDocsById[id]).join('\n\n---\n\n') : '';
  return { compactList, runSkillTool, getFullSkillDoc, skillDocs };
}
