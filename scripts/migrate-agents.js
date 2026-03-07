#!/usr/bin/env node

import { ensureStateDir } from '../lib/paths.js';
import { ensureMainAgentInitialized, purgeLegacyGroups, DEFAULT_AGENT_ID } from '../lib/agent-config.js';
import { ensureGroupConfigFor, saveGroupRestrictions } from '../lib/group-config.js';

function main() {
  ensureStateDir();
  ensureMainAgentInitialized();
  purgeLegacyGroups();
  ensureGroupConfigFor('default');
  saveGroupRestrictions('default', { agentId: DEFAULT_AGENT_ID, skillsDeny: [], tools: { deny: [] } });
  console.log('[migrate-agents] done: main agent initialized, legacy group configs removed, default group restrictions reset.');
}

main();
