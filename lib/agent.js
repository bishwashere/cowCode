/**
 * Shared agent turn: tool loop (run_skill) + final reply resolution.
 * Used by both chat (index.js) and cron runner so the LLM can call the same skills in both.
 */

import { chat as llmChat, chatWithTools } from '../llm.js';
import { executeSkill } from '../skills/executor.js';

export function stripThinking(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

const MAX_TOOL_ROUNDS = 3;
const CLARIFICATION_RULE = 'When information is missing or unclear (e.g. time, message, which option), or when a tool returns an error, do NOT show the error to the user. Instead reply with a short, friendly question asking for the missing or unclear detail (e.g. "Did you mean tomorrow at 9 or next week?", "What message should I send you?"). Keep the conversation going until you have everything needed—no silent failures, no raw errors.';

/**
 * Run one agent turn: messages -> optional tool calls -> final text to send.
 * @param {object} opts
 * @param {string} opts.userText - User message (or cron job message).
 * @param {object} opts.ctx - { storePath, jid, workspaceDir, scheduleOneShot, startCron }
 * @param {string} opts.systemPrompt - Full system prompt (including skill docs if tools used).
 * @param {Array} opts.tools - run_skill tool array from getSkillContext().
 * @param {Array<{ role: string, content: string }>} [opts.historyMessages] - Optional prior exchanges for context (default []).
 * @returns {Promise<{ textToSend: string }>}
 */
export async function runAgentTurn({ userText, ctx, systemPrompt, tools, historyMessages = [] }) {
  const useTools = Array.isArray(tools) && tools.length > 0;
  const toolsToUse = useTools ? tools : [];
  let messages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userText },
  ];
  let finalContent = '';
  let cronListResult = null;
  let searchResult = null;
  let lastRoundHadToolError = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (!useTools) {
      const rawReply = await llmChat(messages);
      finalContent = stripThinking(rawReply);
      break;
    }
    const { content, toolCalls } = await chatWithTools(messages, toolsToUse);
    if (!toolCalls || toolCalls.length === 0) {
      finalContent = content || '';
      break;
    }
    const assistantMsg = {
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
    messages = messages.concat(assistantMsg);
    lastRoundHadToolError = false;
    for (const tc of toolCalls) {
      let payload = {};
      try {
        payload = JSON.parse(tc.arguments || '{}');
      } catch {
        payload = {};
      }
      const skillId = payload.skill && String(payload.skill).trim();
      const runArgs = payload.arguments && typeof payload.arguments === 'object' ? { ...payload.arguments } : {};
      if (payload.command && String(payload.command).trim()) runArgs.action = String(payload.command).trim();
      const toolName = skillId === 'memory' ? (runArgs.tool || 'memory_search') : undefined;
      const action = runArgs?.action && String(runArgs.action).trim().toLowerCase();
      if (!skillId) {
        const errContent = JSON.stringify({ error: 'run_skill requires "skill" and "arguments".' });
        lastRoundHadToolError = true;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: errContent });
        continue;
      }
      console.log('[agent] run_skill', skillId, tc.arguments?.slice(0, 80));
      const result = await executeSkill(skillId, ctx, runArgs, toolName);
      const isToolError = typeof result === 'string' && result.trim().startsWith('{"error":');
      if (isToolError) lastRoundHadToolError = true;
      if (skillId === 'cron' && action === 'list' && result && typeof result === 'string' && !isToolError) {
        cronListResult = result;
      }
      if (skillId === 'search' && result && typeof result === 'string') {
        const newHasHeadlines = result.includes('Top news / headlines');
        const newIsError = result.trim().startsWith('{"error":') || result.includes('The search engine returned an error');
        const currentIsError = !searchResult || searchResult.trim().startsWith('{"error":') || searchResult.includes('The search engine returned an error');
        if (!searchResult || newHasHeadlines || (currentIsError && !newIsError)) searchResult = result;
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  if (useTools && !stripThinking(finalContent).trim() && lastRoundHadToolError) {
    try {
      const { content: clarification } = await chatWithTools(messages, []);
      const text = clarification && stripThinking(clarification).trim();
      if (text) finalContent = text;
    } catch (_) {}
  }
  if (searchResult && !stripThinking(finalContent).trim()) {
    try {
      const synthesized = await chatWithTools(messages, []);
      const reply = synthesized?.content && stripThinking(synthesized.content).trim();
      if (reply) finalContent = reply;
    } catch (_) {}
  }

  const trimmedFinal = stripThinking(finalContent).trim();
  const looksLikeToolCallJson = /"skill"\s*:|\"run_skill\"|"action"\s*:\s*"search"|"parameters"\s*:\s*\{/.test(trimmedFinal);
  const hasNumberedHeadlines = /\n\d+\.\s+.+/.test(trimmedFinal) || /^\d+\.\s+.+/.test(trimmedFinal);
  const searchHasNewsBlock = searchResult && searchResult.includes('Top news / headlines');
  const useSearchResultAsReply = searchResult && searchResult.trim() && (
    !trimmedFinal ||
    looksLikeToolCallJson ||
    (searchHasNewsBlock && !hasNumberedHeadlines)
  );

  const withPrefix = (s) => (s && /^\[CowCode\]\s*/i.test(s.trim()) ? s.trim() : '[CowCode] ' + (s || '').trim());
  let textToSend;
  if (useSearchResultAsReply) {
    let reply = searchResult.trim();
    try {
      const parsed = JSON.parse(reply);
      if (parsed && typeof parsed.error === 'string') {
        const err = parsed.error;
        if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
          reply = "I couldn't run the search because the browser isn't set up. Run: pnpm exec playwright install";
        } else {
          reply = 'Search failed: ' + err;
        }
      }
    } catch (_) {}
    reply = reply.slice(0, 2000) + (reply.length > 2000 ? '…' : '');
    textToSend = withPrefix(reply);
  } else if (trimmedFinal) {
    textToSend = withPrefix(trimmedFinal);
  } else if (cronListResult && cronListResult.trim()) {
    textToSend = withPrefix(cronListResult.trim());
  } else if (searchResult && searchResult.trim()) {
    let reply = searchResult.trim();
    try {
      const parsed = JSON.parse(reply);
      if (parsed && typeof parsed.error === 'string') {
        const err = parsed.error;
        if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
          reply = "I couldn't run the search because the browser isn't set up. Run: pnpm exec playwright install";
        } else {
          reply = 'Search failed: ' + err;
        }
      }
    } catch (_) {}
    reply = reply.slice(0, 2000) + (reply.length > 2000 ? '…' : '');
    textToSend = withPrefix(reply);
  } else {
    textToSend = '[CowCode] Done. Anything else?';
  }
  const body = textToSend.replace(/^\[CowCode\]\s*/i, '').trim();
  if (body.startsWith('{"error":')) {
    textToSend = '[CowCode] I need a bit more detail—when should I remind you, and what message would you like?';
  }
  return { textToSend };
}

export { CLARIFICATION_RULE };
