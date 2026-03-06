#!/usr/bin/env node
/**
 * One-off agent run for the dashboard chat UI.
 * Reads JSON from stdin: { "message": "...", "history": [ { "role": "user"|"assistant", "content": "..." } ] }
 * Writes one JSON line to stdout: { "textToSend": "..." } or { "error": "..." }
 * Uses same soul/identity and skills as main app (workspace SOUL.md, WhoAmI.md, MyHuman.md).
 */

import { getEnvPath, getConfigPath, getCronStorePath, getWorkspaceDir } from '../lib/paths.js';
import dotenv from 'dotenv';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { buildOneOnOneSystemPrompt } from '../lib/system-prompt.js';

dotenv.config({ path: getEnvPath() });

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || '{}');
  const message = payload.message && String(payload.message).trim();
  if (!message) {
    process.stdout.write(JSON.stringify({ error: 'message is required' }) + '\n');
    process.exit(1);
  }
  const history = Array.isArray(payload.history) ? payload.history : [];
  const historyMessages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: String(m.content) }));

  const workspaceDir = getWorkspaceDir();
  const noop = () => {};
  const ctx = {
    storePath: getCronStorePath(),
    jid: 'dashboard',
    workspaceDir,
    scheduleOneShot: noop,
    startCron: noop,
  };
  const skillContext = getSkillContext();
  const toolsToUse = Array.isArray(skillContext.runSkillTool) && skillContext.runSkillTool.length > 0 ? skillContext.runSkillTool : [];

  try {
    const { textToSend } = await runAgentTurn({
      userText: message,
      ctx,
      systemPrompt: buildOneOnOneSystemPrompt(),
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
