/**
 * Sync GitHub setup hints for the system prompt (no API calls).
 */

import { readFileSync, existsSync } from 'fs';
import { getConfigPath, getSecretsPath, getEnvPath } from './paths.js';

function hasGithubToken() {
  if (process.env.GITHUB_TOKEN?.trim()) return true;
  try {
    const raw = readFileSync(getSecretsPath(), 'utf8');
    const secrets = JSON.parse(raw);
    if (secrets?.github?.token?.trim()) return true;
  } catch (_) {}
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    if (config?.skills?.github?.token?.trim()) return true;
  } catch (_) {}
  try {
    if (existsSync(getEnvPath())) {
      const raw = readFileSync(getEnvPath(), 'utf8');
      if (/^GITHUB_TOKEN\s*=\s*\S+/m.test(raw)) return true;
    }
  } catch (_) {}
  return false;
}

function getDefaultGithubOwner() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    const explicit = config?.skills?.github?.defaultOwner?.trim();
    if (explicit) return explicit;
    const repo = config?.skills?.github?.defaultRepo?.trim();
    if (repo && repo.includes('/')) return repo.split('/')[0].trim();
  } catch (_) {}
  return null;
}

/**
 * One-line block appended to the system prompt when GitHub is configured.
 * @returns {string}
 */
export function getGithubSystemPromptBlock() {
  if (!hasGithubToken()) return '';
  const owner = getDefaultGithubOwner();
  const ownerLine = owner
    ? `Default GitHub owner from config: ${owner}. `
    : '';
  return (
    '\n\nGitHub is configured on this system (single authenticated account). ' +
    ownerLine +
    'When the user asks about "my repos", repo counts, or GitHub without naming another user/org, ' +
    'call github_list_repos with no owner (uses the token account). Do not ask for a GitHub username ' +
    'and do not guess owner from the user\'s real name.'
  );
}
