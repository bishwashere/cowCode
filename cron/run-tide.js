/**
 * Standalone entrypoint to run one Tide cycle in a separate process (own execution chain).
 * Does not block chat. Reads payload from stdin as JSON; writes { "textToSend": "..." } to stdout.
 * Parent process sends the reply to the user's chat (like cron).
 *
 * Usage: node cron/run-tide.js < payload.json
 * Payload: { "jid": "...", "storePath": "?", "workspaceDir": "?" }
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getEnvPath, getCronStorePath, getWorkspaceDir, getStateDir, getConfigPath } from '../lib/paths.js';
import dotenv from 'dotenv';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { getSchedulingTimeContext } from '../lib/timezone.js';

dotenv.config({ path: getEnvPath() });

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = (process.env.COWCODE_INSTALL_DIR && join(process.env.COWCODE_INSTALL_DIR)) || join(__dirname, '..');
const DEFAULT_WORKSPACE_DIR = join(INSTALL_DIR, 'workspace-default');
const SOUL_MD = 'SOUL.md';
const WHO_AM_I_MD = 'WhoAmI.md';
const MY_HUMAN_MD = 'MyHuman.md';

function readWorkspaceMd(workspaceDir, filename) {
  try {
    const p = join(workspaceDir, filename);
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}

function readDefaultSoul() {
  try {
    const p = join(DEFAULT_WORKSPACE_DIR, SOUL_MD);
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}

function getBioFromConfig() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const full = JSON.parse(raw);
    return full.bio || null;
  } catch (_) {
    return null;
  }
}

/** Build one-on-one style system prompt for Tide (soul + identity + time + tide instruction). */
function buildTideSystemPrompt(workspaceDir) {
  const timeCtx = getSchedulingTimeContext();
  const timeBlock = `\n\n${timeCtx.timeContextLine}\nCurrent time UTC (for scheduling "at"): ${timeCtx.nowIso}. Examples: "in 1 minute" = ${timeCtx.in1min}; "in 2 minutes" = ${timeCtx.in2min}; "in 3 minutes" = ${timeCtx.in3min}.`;
  const pathsLine = `\n\nCowCode on this system: state dir ${getStateDir()}, workspace ${workspaceDir}. When the user asks where cowcode is installed or where config is, use the read skill with path \`~/.cowcode/config.json\` (or the state dir path above) to show config and confirm.`;
  let soulContent = readWorkspaceMd(workspaceDir, SOUL_MD) || readDefaultSoul();
  soulContent = soulContent ? soulContent + pathsLine : pathsLine.trim();
  let whoAmIContent = readWorkspaceMd(workspaceDir, WHO_AM_I_MD);
  const myHumanContent = readWorkspaceMd(workspaceDir, MY_HUMAN_MD);
  if (!whoAmIContent && !myHumanContent) {
    const bio = getBioFromConfig();
    if (bio != null && typeof bio === 'string' && bio.trim()) whoAmIContent = bio.trim();
    else if (bio != null && typeof bio === 'object' && (bio.userName || bio.assistantName || bio.whoAmI || bio.whoAreYou)) {
      const parts = [];
      if (bio.userName) parts.push(`The user's name is ${bio.userName}.`);
      if (bio.assistantName) parts.push(`Your name is ${bio.assistantName}.`);
      if (bio.whoAmI) parts.push(`The user describes themselves: ${bio.whoAmI}.`);
      if (bio.whoAreYou) parts.push(`You describe yourself: ${bio.whoAreYou}.`);
      if (parts.length) whoAmIContent = parts.join(' ');
    }
  }
  let identityBlock = '';
  if (whoAmIContent) identityBlock += '\n\n' + whoAmIContent;
  if (myHumanContent) identityBlock += '\n\n' + myHumanContent;
  const base = soulContent + identityBlock;
  const tideLine = `

# Tide (quiet check)
The chat has been quiet. Only speak if you have something short, useful, and tied to what you were last doing. Examples: "Still no reply on that poll request. Should I follow up?" or "I ran the tests. Everything passed. What's next?"
Only say something when: a follow-up is needed (e.g. waiting on their reply), you finished something that needs sign-off, or there is one concrete next step. Otherwise reply with nothing or a single line like "nothing to do". Do not double-text. If they don't answer after this, we will not ping again until much later. Be quietly helpful—not clingy. Quiet is golden.`;
  return base + timeBlock + tideLine;
}

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
  const { runSkillTool, getFullSkillDoc } = getSkillContext();
  const toolsToUse = Array.isArray(runSkillTool) && runSkillTool.length > 0 ? runSkillTool : [];
  const systemPrompt = buildTideSystemPrompt(workspaceDir);
  const { textToSend } = await runAgentTurn({
    userText,
    ctx,
    systemPrompt,
    tools: toolsToUse,
    historyMessages,
    getFullSkillDoc,
  });
  process.stdout.write(JSON.stringify({ textToSend: textToSend || '' }) + '\n');
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
  process.exit(1);
});
