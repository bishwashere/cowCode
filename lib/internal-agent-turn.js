/**
 * Internal agent-to-agent turn runner (tier 2: local, with persistent pair history).
 *
 * Runs one full agent turn for a target agent WITHOUT sending to any channel
 * (WhatsApp/Telegram). This is the "silent" sibling of scripts/chat-dashboard.js:
 * same pipeline (config -> enabled skills -> intent plan -> skill context ->
 * system prompt -> runAgentTurn) but returns text to the caller instead of a chat.
 *
 * Conversation history between two agents is persisted in the TARGET agent's
 * workspace, keyed by the caller, so repeated delegations are stateful
 * (PM <-> backend remembers prior exchanges). Disable with persistHistory: false.
 *
 * Recursion is guarded by depth + callChain, which the agent-send executor
 * increments on each hop. ctx.runInternalAgent is injected so nested delegation
 * works without a circular import (executor reads it off ctx).
 */

import { getCronStorePath, getAgentWorkspaceDir } from './paths.js';
import { runAgentTurn } from './agent.js';
import { getSkillContext, getEnabledSkillIds, getEnabledSkillSummaries } from '../skills/loader.js';
import { planIntent, intentPlanToSystemBlock } from './intent-planner.js';
import { buildOneOnOneSystemPrompt } from './system-prompt.js';
import { buildSessionBootstrapContext } from './session-bootstrap.js';
import { ensureMainAgentInitialized, loadAgentConfig, DEFAULT_AGENT_ID } from './agent-config.js';
import { ensureChatSession } from './chat-session.js';
import { appendExchange, readLastPrivateExchanges } from './chat-log.js';

const DEFAULT_PAIR_HISTORY_EXCHANGES = 5;

const noop = () => {};

/** Stable per-pair key for session + chat-log file (stored in target's workspace). */
function pairLogKey(callerAgentId, targetAgentId) {
  return `internal:${callerAgentId}->${targetAgentId}`;
}

/**
 * Run one silent turn for another agent and return its reply.
 *
 * @param {object} opts
 * @param {string} opts.targetAgentId - Agent that should handle the message.
 * @param {string} opts.userText - The delegated task/question.
 * @param {string} [opts.callerAgentId] - Agent doing the delegating (for history + chain).
 * @param {number} [opts.depth] - Current recursion depth (0 = top-level human turn).
 * @param {string[]} [opts.callChain] - Agent ids already in this chain (loop guard).
 * @param {boolean} [opts.persistHistory] - Persist the pair conversation (default true).
 * @returns {Promise<{ textToSend: string, skillsCalled: string[], agentId: string }>}
 */
export async function runInternalAgentTurn({
  targetAgentId,
  userText,
  callerAgentId = DEFAULT_AGENT_ID,
  depth = 1,
  callChain = [],
  persistHistory = true,
}) {
  ensureMainAgentInitialized();
  const agentId = String(targetAgentId || '').trim();
  if (!agentId) throw new Error('targetAgentId is required');
  const text = String(userText || '').trim();
  if (!text) throw new Error('userText is required');

  loadAgentConfig(agentId);
  const workspaceDir = getAgentWorkspaceDir(agentId);

  // Tier-2 pair history: stored in the TARGET agent's workspace, keyed by caller.
  const logKey = pairLogKey(callerAgentId, agentId);
  const { sessionId, rotated } = ensureChatSession(logKey, { userText: text });
  const historyMessages = persistHistory
    ? readLastPrivateExchanges(workspaceDir, logKey, DEFAULT_PAIR_HISTORY_EXCHANGES, sessionId)
    : [];

  // ctx mirrors the dashboard runner, plus injected agent-to-agent fields so the
  // agent-send executor can delegate further (depth/chain carried forward).
  const ctx = {
    storePath: getCronStorePath(),
    jid: logKey,
    workspaceDir,
    agentId,
    scheduleOneShot: noop,
    startCron: noop,
    isGroup: false,
    runInternalAgent: runInternalAgentTurn,
    agentDepth: depth,
    agentCallChain: Array.isArray(callChain) && callChain.length ? callChain : [callerAgentId, agentId],
    callerAgentId,
  };

  const enabledSkillIds = getEnabledSkillIds({ agentId });
  const enabledSkillSummaries = getEnabledSkillSummaries({ agentId });
  const intentPlan = enabledSkillIds.length > 0
    ? await planIntent({ userText: text, availableSkillIds: enabledSkillIds, availableSkillSummaries: enabledSkillSummaries, agentId })
    : null;

  const plannerSaysNoTools = intentPlan !== null && Array.isArray(intentPlan.skills) && intentPlan.skills.length === 0;
  let skillContext = null;
  let toolsToUse = [];
  if (!plannerSaysNoTools) {
    skillContext = getSkillContext({ agentId, hintSkills: intentPlan?.skills ?? null });
    toolsToUse = Array.isArray(skillContext.runSkillTool) && skillContext.runSkillTool.length > 0
      ? skillContext.runSkillTool
      : [];
  }

  const baseSystemPrompt = buildOneOnOneSystemPrompt(workspaceDir);
  const planBlock = intentPlanToSystemBlock(intentPlan);
  let systemPrompt = planBlock ? baseSystemPrompt + '\n\n' + planBlock : baseSystemPrompt;
  if (rotated) systemPrompt += buildSessionBootstrapContext(workspaceDir).block;

  const turn = await runAgentTurn({
    userText: text,
    ctx,
    systemPrompt,
    tools: toolsToUse,
    historyMessages,
    getFullSkillDoc: skillContext?.getFullSkillDoc ?? (() => ''),
    resolveToolName: skillContext?.resolveToolName ?? (() => null),
  });

  const textToSend = (turn?.textToSend || '').trim();
  const skillsCalled = Array.isArray(turn?.skillsCalled) ? turn.skillsCalled : [];

  if (persistHistory && textToSend) {
    try {
      appendExchange(workspaceDir, {
        user: text,
        assistant: textToSend,
        timestampMs: Date.now(),
        jid: logKey,
        sessionId,
      });
    } catch (_) {}
  }

  return { textToSend, skillsCalled, agentId };
}
