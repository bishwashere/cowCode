/**
 * Standalone entrypoint to run one Tide cycle in a separate process (own execution chain).
 * Does not block chat. Reads payload from stdin as JSON; writes { "textToSend": "..." } to stdout.
 * Parent process sends the reply to the user's chat (like cron).
 *
 * Same main LLM as chat; only the Tide (quiet check) instruction is added as an extra skill.
 *
 * Usage: node cron/run-tide.js < payload.json
 * Payload: { "jid": "...", "storePath": "?", "workspaceDir": "?" }
 */

import { getEnvPath, getCronStorePath, getWorkspaceDir } from '../lib/paths.js';
import dotenv from 'dotenv';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { getSchedulingTimeContext } from '../lib/timezone.js';
import { buildOneOnOneSystemPrompt } from '../lib/system-prompt.js';

dotenv.config({ path: getEnvPath() });

const TIDE_INSTRUCTION = `

# Tide (quiet check)
The chat has been quiet. Only speak if you have something short, useful, and tied to what you were last doing. Examples: "Still no reply on that poll request. Should I follow up?" or "I ran the tests. Everything passed. What's next?"
Only say something when: a follow-up is needed (e.g. waiting on their reply), you finished something that needs sign-off, or there is one concrete next step. Otherwise reply with nothing or a single line like "nothing to do". Do not double-text. If they don't answer after this, we will not ping again until much later. Be quietly helpful—not clingy. Quiet is golden.`;

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || '{}');
  const jid = payload.jid && String(payload.jid).trim();
  if (!jid) {
    process.stdout.write(JSON.stringify({ error: 'jid required' }) + '\n');
    process.exit(1);
  }
  const storePath = payload.storePath && String(payload.storePath).trim() || getCronStorePath();
  const workspaceDir = payload.workspaceDir && String(payload.workspaceDir).trim() || getWorkspaceDir();
  const historyMessages = Array.isArray(payload.historyMessages)
    ? payload.historyMessages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    : [];
  const timeCtx = getSchedulingTimeContext();
  const userText =
    '[Tide] Chat has been quiet. Current time: ' +
    timeCtx.nowIso +
    '. Based on the last few messages: is there one short, useful thing to say? (e.g. follow-up on something we are waiting on, or "I finished X—what next?") If yes, reply with that only. If no, reply with nothing or "nothing to do".';
  const noop = () => {};
  const ctx = { storePath, jid, workspaceDir, scheduleOneShot: noop, startCron: noop, groupNonOwner: false };
  const { runSkillTool, getFullSkillDoc, resolveToolName } = getSkillContext();
  const toolsToUse = Array.isArray(runSkillTool) && runSkillTool.length > 0 ? runSkillTool : [];
  const systemPrompt = buildOneOnOneSystemPrompt(workspaceDir) + TIDE_INSTRUCTION;
  const { textToSend } = await runAgentTurn({
    userText,
    ctx,
    systemPrompt,
    tools: toolsToUse,
    historyMessages,
    getFullSkillDoc,
    resolveToolName,
  });
  process.stdout.write(JSON.stringify({ textToSend: textToSend || '' }) + '\n');
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
  process.exit(1);
});
