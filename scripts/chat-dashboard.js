#!/usr/bin/env node
/**
 * One-off agent run for the dashboard chat UI.
 * Reads JSON from stdin: { "message": "...", "history": [ { "role": "user"|"assistant", "content": "..." } ] }
 * Writes one JSON line to stdout: { "textToSend": "..." } or { "error": "..." }
 * Uses same soul/identity and skills as main app (workspace SOUL.md, WhoAmI.md, MyHuman.md).
 */

import { getEnvPath, getCronStorePath, getWorkspaceDir, getAgentWorkspaceDir } from '../lib/paths.js';
import dotenv from 'dotenv';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { buildOneOnOneSystemPrompt } from '../lib/system-prompt.js';
import { DEFAULT_AGENT_ID, ensureMainAgentInitialized, loadAgentConfig } from '../lib/agent-config.js';

dotenv.config({ path: getEnvPath() });

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || '{}');
  const message = payload.message && String(payload.message).trim();
  const requestedAgentId = payload.agentId && String(payload.agentId).trim();
  ensureMainAgentInitialized();
  const agentId = requestedAgentId || DEFAULT_AGENT_ID;
  loadAgentConfig(agentId);
  if (!message) {
    process.stdout.write(JSON.stringify({ error: 'message is required' }) + '\n');
    process.exit(1);
  }
  const history = Array.isArray(payload.history) ? payload.history : [];
  const historyMessages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: String(m.content) }));

  const workspaceDir = getAgentWorkspaceDir(agentId) || getWorkspaceDir();
  const noop = () => {};
  const ctx = {
    storePath: getCronStorePath(),
    jid: 'dashboard:' + agentId,
    workspaceDir,
    agentId,
    scheduleOneShot: noop,
    startCron: noop,
  };
  const skillContext = getSkillContext({ agentId });
  const toolsToUse = Array.isArray(skillContext.runSkillTool) && skillContext.runSkillTool.length > 0 ? skillContext.runSkillTool : [];

  try {
    const { textToSend } = await runAgentTurn({
      userText: message,
      ctx,
      systemPrompt: buildOneOnOneSystemPrompt(workspaceDir),
      tools: toolsToUse,
      historyMessages,
      getFullSkillDoc: skillContext.getFullSkillDoc,
      resolveToolName: skillContext.resolveToolName,
    });
    process.stdout.write(JSON.stringify({ textToSend: textToSend || '' }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
    process.exit(1);
  }
}

main();
