#!/usr/bin/env node
/**
 * One-off agent run for the dashboard chat UI.
 * Reads JSON from stdin: { "message": "...", "history": [...], "agentId": "..." }
 * Writes NDJSON to stdout (line-delimited JSON):
 *   { "type": "progress", "message": "..." } — filesystem / shell steps as they run
 *   { "type": "done", "reply": "..." } — final assistant text
 *   { "type": "error", "error": "..." } — failure
 * Uses same soul/identity and skills as main app (workspace SOUL.md, WhoAmI.md, MyHuman.md).
 */

import { writeSync } from 'fs';
import { getEnvPath, getCronStorePath, getWorkspaceDir, getAgentWorkspaceDir } from '../lib/paths.js';
import dotenv from 'dotenv';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { buildOneOnOneSystemPrompt } from '../lib/system-prompt.js';
import { DEFAULT_AGENT_ID, ensureMainAgentInitialized, loadAgentConfig } from '../lib/agent-config.js';

dotenv.config({ path: getEnvPath() });

function writeNdjsonLine(obj) {
  const line = JSON.stringify(obj) + '\n';
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(line);
    } else {
      writeSync(process.stdout.fd, line);
    }
  } catch (_) {
    process.stdout.write(line);
  }
}

function formatDashboardReply(textToSend) {
  let reply = textToSend != null ? String(textToSend) : '';
  reply = reply.replace(/(^|\n)\s*\[CowCode\]\s*/gi, '$1').trim();
  return reply;
}

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
    writeNdjsonLine({ type: 'error', error: 'message is required' });
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
      onToolProgress: (msg) => {
        const m = msg != null ? String(msg).trim() : '';
        if (m) writeNdjsonLine({ type: 'progress', message: m });
      },
    });
    writeNdjsonLine({ type: 'done', reply: formatDashboardReply(textToSend) });
  } catch (err) {
    writeNdjsonLine({ type: 'error', error: err.message || String(err) });
    process.exit(1);
  }
}

main();
