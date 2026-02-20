/**
 * Group folder: config, SOUL, identity for group chat. Machine-editable only.
 * When the group dir is first created, copy all main config/workspace content there
 * with skills.enabled = main minus core, read, and cron (not available in groups by default).
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfigPath, getWorkspaceDir, getGroupDir, getGroupConfigPath } from './paths.js';

/** Skills excluded from group by default: core, read, cron. */
const GROUP_DEFAULT_EXCLUDED = new Set(['core', 'read', 'cron']);
/** Default group enabled list when no config (main default minus excluded). */
const FALLBACK_GROUP_ENABLED = ['search', 'browse', 'vision', 'memory', 'speech', 'gog'];
const WORKSPACE_FILES = ['SOUL.md', 'WhoAmI.md', 'MyHuman.md'];
const INITIALIZED_MARKER = '.initialized';

function filterGroupEnabled(ids) {
  return ids.filter((id) => !GROUP_DEFAULT_EXCLUDED.has(id));
}

/**
 * If group dir has no config (or no marker), copy from main: workspace SOUL/WhoAmI/MyHuman
 * and config.json with skills.enabled = main enabled minus core, read, cron. Idempotent after first run.
 */
export function ensureGroupDirInitialized() {
  const groupDir = getGroupDir();
  if (!existsSync(groupDir)) mkdirSync(groupDir, { recursive: true });
  const markerPath = join(groupDir, INITIALIZED_MARKER);
  if (existsSync(markerPath)) return;

  const workspaceDir = getWorkspaceDir();
  for (const name of WORKSPACE_FILES) {
    const src = join(workspaceDir, name);
    const dest = join(groupDir, name);
    if (existsSync(src)) {
      try {
        copyFileSync(src, dest);
      } catch (err) {
        console.error('[group] copy', name, err.message);
      }
    }
  }

  try {
    const mainConfigPath = getConfigPath();
    const raw = existsSync(mainConfigPath) ? readFileSync(mainConfigPath, 'utf8') : '{}';
    const config = raw.trim() ? JSON.parse(raw) : {};
    const mainSkills = config.skills && typeof config.skills === 'object' ? config.skills : {};
    const mainEnabled = Array.isArray(mainSkills.enabled) ? mainSkills.enabled : ['cron', 'search', 'browse', 'vision', 'memory', 'speech', 'gog', 'read'];
    const groupEnabled = filterGroupEnabled(mainEnabled);
    const groupConfig = {
      ...config,
      skills: {
        ...mainSkills,
        enabled: groupEnabled,
      },
    };
    writeFileSync(getGroupConfigPath(), JSON.stringify(groupConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('[group] init config failed:', err.message);
  }

  try {
    writeFileSync(markerPath, String(Date.now()), 'utf8');
  } catch (_) {}
}

/**
 * Skills enabled for group: from group/config.json if present, else main enabled minus core/read/cron.
 * @returns {string[]}
 */
export function getGroupSkillsEnabled() {
  const groupConfigPath = getGroupConfigPath();
  if (existsSync(groupConfigPath)) {
    try {
      const raw = readFileSync(groupConfigPath, 'utf8');
      const config = raw.trim() ? JSON.parse(raw) : {};
      const skills = config.skills && typeof config.skills === 'object' ? config.skills : {};
      const enabled = Array.isArray(skills.enabled) ? skills.enabled : FALLBACK_GROUP_ENABLED;
      return filterGroupEnabled(enabled);
    } catch (_) {}
  }
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const mainEnabled = Array.isArray(config.skills?.enabled) ? config.skills.enabled : FALLBACK_GROUP_ENABLED;
    return filterGroupEnabled(mainEnabled);
  } catch (_) {
    return [...FALLBACK_GROUP_ENABLED];
  }
}

/**
 * Read a markdown file from the group dir. Returns empty string if missing.
 * @param {string} filename - e.g. 'SOUL.md', 'WhoAmI.md', 'MyHuman.md'
 * @returns {string}
 */
export function readGroupMd(filename) {
  const p = join(getGroupDir(), filename);
  try {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}
