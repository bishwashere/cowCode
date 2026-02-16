/**
 * State directory and paths. Config, auth, and cron live in ~/.cowcode (or COWCODE_STATE_DIR).
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';

const STATE_DIRNAME = '.cowcode';

/**
 * Resolve state directory. Override with COWCODE_STATE_DIR.
 * @returns {string} Absolute path to state dir (e.g. ~/.cowcode).
 */
export function getStateDir() {
  const override = process.env.COWCODE_STATE_DIR?.trim();
  if (override) return override.startsWith('/') ? override : join(process.cwd(), override);
  return join(homedir(), STATE_DIRNAME);
}

/**
 * Config file path (state dir / config.json).
 */
export function getConfigPath() {
  return join(getStateDir(), 'config.json');
}

/**
 * Auth state directory for WhatsApp (Baileys).
 */
export function getAuthDir() {
  return join(getStateDir(), 'auth_info');
}

/**
 * Cron jobs store path (state dir / cron / jobs.json).
 */
export function getCronStorePath() {
  return join(getStateDir(), 'cron', 'jobs.json');
}

/**
 * .env file path in state dir.
 */
export function getEnvPath() {
  return join(getStateDir(), '.env');
}

/**
 * Workspace directory for memory files (MEMORY.md, memory/*.md).
 * @returns {string} Absolute path (e.g. ~/.cowcode/workspace).
 */
export function getWorkspaceDir() {
  return join(getStateDir(), 'workspace');
}

/**
 * Memory index directory (contains index.db).
 * @returns {string} Absolute path (e.g. ~/.cowcode/memory).
 */
export function getMemoryDir() {
  return join(getStateDir(), 'memory');
}

/**
 * SQLite memory index path.
 * @returns {string} Absolute path (e.g. ~/.cowcode/memory/index.db).
 */
export function getMemoryIndexPath() {
  return join(getMemoryDir(), 'index.db');
}

/**
 * Ensure state dir and subdirs (auth_info, cron, workspace, memory) exist.
 */
export function ensureStateDir() {
  const stateDir = getStateDir();
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  const authDir = getAuthDir();
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
  const cronDir = join(getStateDir(), 'cron');
  if (!existsSync(cronDir)) mkdirSync(cronDir, { recursive: true });
  const workspaceDir = getWorkspaceDir();
  if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
  const memoryDir = getMemoryDir();
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const workspaceMemoryDir = join(workspaceDir, 'memory');
  if (!existsSync(workspaceMemoryDir)) mkdirSync(workspaceMemoryDir, { recursive: true });
}
