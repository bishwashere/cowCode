/**
 * Skill install: add a skill to skills.enabled and prompt for required env vars.
 * Used by: cowcode skills install <skill-id>
 */

import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigPath, getEnvPath, ensureStateDir } from './paths.js';

/** Aliases for skill id (e.g. homeassistant -> home-assistant). */
const SKILL_ALIASES = {
  homeassistant: 'home-assistant',
  homeassistnat: 'home-assistant',
  home_assistant: 'home-assistant',
  ha: 'home-assistant',
};

/**
 * Env vars to prompt for when installing a skill. Only skills that need env vars are listed.
 * @type {Record<string, { prompt: string, envVars: Array<{ name: string, prompt: string }> }>}
 */
const SKILL_INSTALL_PROMPTS = {
  'home-assistant': {
    prompt: 'Home Assistant',
    envVars: [
      { name: 'HA_URL', prompt: 'Home Assistant URL (optional, press Enter for http://localhost:8123)' },
      { name: 'HA_TOKEN', prompt: 'Home Assistant long-lived access token' },
    ],
  },
};

function parseEnv(content) {
  const lines = (content || '').split('\n');
  const out = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (key && !key.startsWith('#')) out[key] = val;
  }
  return out;
}

function stringifyEnv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      const val = String(v ?? '');
      if (val.includes('=') || val.includes(' ') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `${k}="${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
      }
      return `${k}=${val}`;
    })
    .join('\n');
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/**
 * Normalize user input to canonical skill id.
 * @param {string} raw - e.g. "homeassistant" or "home-assistant"
 * @returns {string} e.g. "home-assistant"
 */
export function normalizeSkillId(raw) {
  const s = (raw || '').trim().toLowerCase().replace(/\s+/g, '-');
  return SKILL_ALIASES[s] || s;
}

/**
 * Check if a skill exists (has SKILL.md in skills/<id>/).
 * @param {string} installDir - CowCode install root (contains skills/)
 * @param {string} skillId - Canonical skill id
 */
export function skillExists(installDir, skillId) {
  const mdPath = join(installDir, 'skills', skillId, 'SKILL.md');
  return existsSync(mdPath);
}

/**
 * Get list of skill ids that have install prompts (can be installed via this command).
 */
export function getInstallableSkillIds() {
  return Object.keys(SKILL_INSTALL_PROMPTS);
}

/**
 * Run the install flow for a skill: ensure enabled, prompt for env vars, write .env and config.
 * @param {string} skillId - Canonical skill id (e.g. "home-assistant")
 * @param {string} installDir - CowCode install root
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function runSkillInstall(skillId, installDir) {
  if (!skillId) {
    return { ok: false, message: 'Skill id is required. Example: cowcode skills install home-assistant' };
  }

  if (!skillExists(installDir, skillId)) {
    return {
      ok: false,
      message: `Skill "${skillId}" not found. Check the id (e.g. home-assistant) and that cowCode is installed correctly.`,
    };
  }

  const meta = SKILL_INSTALL_PROMPTS[skillId];
  if (!meta) {
    return {
      ok: false,
      message: `Skill "${skillId}" has no install prompts. Add it to skills.enabled in config (e.g. in Dashboard or by editing ${getConfigPath()}).`,
    };
  }

  ensureStateDir();
  const configPath = getConfigPath();
  let config = {};
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    return { ok: false, message: `Could not read config: ${e && e.message}` };
  }

  const enabled = Array.isArray(config.skills?.enabled) ? config.skills.enabled : [];
  const alreadyEnabled = enabled.includes(skillId);

  const envPath = getEnvPath();
  const envContent = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const env = parseEnv(envContent);

  console.log('');
  console.log(`Installing skill: ${meta.prompt} (${skillId})`);
  if (alreadyEnabled) {
    console.log('  (already in skills.enabled; will only update env vars)');
  }
  console.log('');

  for (const { name, prompt: p } of meta.envVars) {
    const current = env[name] || '';
    const promptText = current
      ? `${p} [${current.slice(0, 20)}${current.length > 20 ? '…' : ''}]`
      : p;
    const value = await ask(`${promptText}: `);
    if (value !== '') env[name] = value;
  }

  writeFileSync(envPath, stringifyEnv(env), 'utf8');
  console.log('  ✓ Env vars saved to', envPath);

  if (!alreadyEnabled) {
    config.skills = config.skills || {};
    config.skills.enabled = [...enabled, skillId];
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('  ✓ Added to skills.enabled in config.');
  }

  console.log('');
  console.log('Done. Restart the bot (cowcode moo restart) to use the skill.');
  return { ok: true, message: `${skillId} installed.` };
}
