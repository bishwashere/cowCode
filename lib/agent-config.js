import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { getConfigPath, getWorkspaceDir, getAgentDir, getAgentConfigPath, getAgentWorkspaceDir, getGroupsDir, getGroupConfigDir, getAgentsDir } from './paths.js';

export const DEFAULT_AGENT_ID = 'main';

const IDENTITY_FILES = ['SOUL.md', 'WhoAmI.md', 'MyHuman.md', 'group.md', 'MEMORY.md'];
const NEW_AGENT_SKILLS_DENY_BY_DEFAULT = new Set([
  'speech',
  'home-assistant',
  'gog',
  'go-write',
  'apply-patch',
]);

function readJson(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    const raw = readFileSync(path, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

function normalizeAgentId(input) {
  const id = String(input || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return id || '';
}

export function ensureAgent(agentId = DEFAULT_AGENT_ID) {
  const dir = getAgentDir(agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const workspace = getAgentWorkspaceDir(agentId);
  if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
  const configPath = getAgentConfigPath(agentId);
  if (!existsSync(configPath)) {
    writeJson(configPath, {});
  }
}

/**
 * Bootstraps main agent from legacy state (main config/workspace).
 * Safe to call repeatedly.
 */
export function ensureMainAgentInitialized() {
  ensureAgent(DEFAULT_AGENT_ID);
  const mainConfigPath = getConfigPath();
  const agentConfigPath = getAgentConfigPath(DEFAULT_AGENT_ID);
  if (existsSync(mainConfigPath)) {
    const legacy = readJson(mainConfigPath, {});
    writeJson(agentConfigPath, legacy);
  }
  const legacyWorkspace = getWorkspaceDir();
  const agentWorkspace = getAgentWorkspaceDir(DEFAULT_AGENT_ID);
  for (const name of IDENTITY_FILES) {
    const src = join(legacyWorkspace, name);
    const dest = join(agentWorkspace, name);
    if (existsSync(src) && !existsSync(dest)) {
      try {
        copyFileSync(src, dest);
      } catch (_) {}
    }
  }
}

export function loadAgentConfig(agentId = DEFAULT_AGENT_ID) {
  ensureMainAgentInitialized();
  ensureAgent(agentId);
  const cfg = readJson(getAgentConfigPath(agentId), {});
  if (Object.keys(cfg).length > 0) return cfg;
  if (agentId !== DEFAULT_AGENT_ID) {
    return loadAgentConfig(DEFAULT_AGENT_ID);
  }
  return {};
}

export function saveAgentConfig(agentId, config) {
  ensureAgent(agentId);
  writeJson(getAgentConfigPath(agentId), config || {});
}

export function createAgent(agentIdInput, options = {}) {
  ensureMainAgentInitialized();
  const agentId = normalizeAgentId(agentIdInput);
  if (!agentId) throw new Error('Agent id is required');
  if (agentId === DEFAULT_AGENT_ID) return { id: DEFAULT_AGENT_ID, created: false };
  if (listAgentIds().includes(agentId)) return { id: agentId, created: false };

  const fromId = options.fromAgentId || DEFAULT_AGENT_ID;
  const baseConfig = loadAgentConfig(fromId);
  const baseEnabled = (baseConfig.skills && Array.isArray(baseConfig.skills.enabled))
    ? baseConfig.skills.enabled
    : ['search', 'browse', 'vision', 'memory', 'read', 'me', 'go-read', 'write', 'edit'];
  const filteredEnabled = baseEnabled.filter((id) => !NEW_AGENT_SKILLS_DENY_BY_DEFAULT.has(String(id)));
  const config = {
    llm: baseConfig.llm || {},
    skills: { ...(baseConfig.skills || {}), enabled: filteredEnabled },
  };
  saveAgentConfig(agentId, config);

  const ws = getAgentWorkspaceDir(agentId);
  if (!existsSync(ws)) mkdirSync(ws, { recursive: true });
  const baseWs = getAgentWorkspaceDir(fromId);
  for (const name of IDENTITY_FILES) {
    const src = join(baseWs, name);
    const dst = join(ws, name);
    if (existsSync(src) && !existsSync(dst)) {
      try { copyFileSync(src, dst); } catch (_) {}
    }
  }
  if (!existsSync(join(ws, 'WhoAmI.md'))) writeFileSync(join(ws, 'WhoAmI.md'), '', 'utf8');
  if (!existsSync(join(ws, 'MyHuman.md'))) writeFileSync(join(ws, 'MyHuman.md'), '', 'utf8');
  if (!existsSync(join(ws, 'SOUL.md'))) writeFileSync(join(ws, 'SOUL.md'), readAgentMd('SOUL.md', fromId), 'utf8');
  if (!existsSync(join(ws, 'group.md'))) writeFileSync(join(ws, 'group.md'), readAgentMd('group.md', fromId), 'utf8');
  return { id: agentId, created: true };
}

export function readAgentMd(filename, agentId = DEFAULT_AGENT_ID) {
  ensureMainAgentInitialized();
  const p = join(getAgentWorkspaceDir(agentId), filename);
  try {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  if (agentId !== DEFAULT_AGENT_ID) return readAgentMd(filename, DEFAULT_AGENT_ID);
  return '';
}

export function listAgentIds() {
  ensureMainAgentInitialized();
  const agentsDir = getAgentsDir();
  try {
    const ids = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(Boolean);
    return ids.length ? ids.sort() : [DEFAULT_AGENT_ID];
  } catch (_) {
    return [DEFAULT_AGENT_ID];
  }
}

export function resolveAgentIdForGroup(groupId) {
  const fromDefault = readJson(join(getGroupConfigDir('default'), 'config.json'), {});
  const fromGroup = groupId ? readJson(join(getGroupConfigDir(groupId), 'config.json'), {}) : {};
  const groupAgent = typeof fromGroup.agentId === 'string' ? fromGroup.agentId.trim() : '';
  const defaultAgent = typeof fromDefault.agentId === 'string' ? fromDefault.agentId.trim() : '';
  return groupAgent || defaultAgent || DEFAULT_AGENT_ID;
}

/**
 * Delete legacy group-level files/config so groups no longer carry soul/llm/skills state.
 */
export function purgeLegacyGroups() {
  const defaultDir = getGroupConfigDir('default');
  if (existsSync(defaultDir)) {
    try { rmSync(defaultDir, { recursive: true, force: true }); } catch (_) {}
  }
  const groupsDir = getGroupsDir();
  if (existsSync(groupsDir)) {
    try {
      const names = readdirSync(groupsDir);
      for (const name of names) {
        const full = join(groupsDir, name);
        try {
          if (statSync(full).isDirectory()) rmSync(full, { recursive: true, force: true });
        } catch (_) {}
      }
    } catch (_) {}
  }
}
