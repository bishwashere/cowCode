/**
 * Shared agent turn: tool loop (run_skill) + final reply resolution.
 * Used by both chat (index.js) and cron runner so the LLM can call the same skills in both.
 */

import { existsSync } from 'fs';
import { chat as llmChat, chatWithTools } from '../llm.js';
import { executeSkill } from '../skills/executor.js';
import { toUserMessage } from './user-error.js';

export function stripThinking(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

/** Remove asterisks from reply so chat items never contain * or **. */
function stripAsterisks(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/\*\*/g, '').replace(/\*/g, '');
}

const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALL_RETRIES = 3;

/** Extract image file path from user message when it contains "Image file: /path/to/file.jpg. " (Telegram/WhatsApp upload). */
function extractImagePathFromMessage(text) {
  if (!text || typeof text !== 'string') return null;
  // Path may contain dots (e.g. .jpg); the trailing ". " is end of sentence, so take path up to last ".\s" or ".$"
  const match = text.match(/Image file:\s*(.+)\.(\s|$)/s);
  const path = match ? match[1].trim() : null;
  if (!path) return null;
  return path;
}

/**
 * Get the most recent image path from chat history (last user message containing "Image file: ...").
 * Only returns a path if the file still exists on disk so vision can use it.
 * @param {Array<{ role: string, content: string }>} historyMessages
 * @returns {string|null}
 */
function getLastImagePathFromHistory(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length === 0) return null;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i];
    if (msg?.role !== 'user' || typeof msg.content !== 'string') continue;
    const path = extractImagePathFromMessage(msg.content);
    if (path && existsSync(path)) return path;
  }
  return null;
}

/** True if runArgs already has an image source for vision (image, url, path, file, filePath, imagePath). */
function hasVisionImageArg(runArgs) {
  if (!runArgs || typeof runArgs !== 'object') return false;
  const v = (key) => runArgs[key] != null && String(runArgs[key]).trim() !== '';
  return v('image') || v('url') || v('path') || v('file') || v('filePath') || v('imagePath');
}

/** Validate tool call arguments: must be parseable JSON and run_skill must have "skill". Returns true if all valid. */
function validateToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return true;
  for (const tc of toolCalls) {
    if (tc.name !== 'run_skill') continue;
    let payload = {};
    try {
      payload = JSON.parse(tc.arguments || '{}');
    } catch {
      return false;
    }
    const skillId = payload.skill && String(payload.skill).trim();
    if (!skillId) return false;
  }
  return true;
}

/**
 * Run one agent turn: messages -> optional tool calls -> final text to send.
 * @param {object} opts
 * @param {string} opts.userText - User message (or cron job message).
 * @param {object} opts.ctx - { storePath, jid, workspaceDir, scheduleOneShot, startCron }
 * @param {string} opts.systemPrompt - Role-only system prompt (soul, Who am I, My human, timezone). Skill descriptions are in the run_skill tool, not here.
 * @param {Array} opts.tools - Skills: run_skill tool array from getSkillContext() (compact list in tool description).
 * @param {Array<{ role: string, content: string }>} [opts.historyMessages] - Optional prior exchanges for context (default []).
 * @param {(skillId: string) => string} [opts.getFullSkillDoc] - When a skill is called, inject full skill doc into the tool result (from getSkillContext()).
 * @returns {Promise<{ textToSend: string }>}
 */
export async function runAgentTurn({ userText, ctx, systemPrompt, tools, historyMessages = [], getFullSkillDoc = null }) {
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
  let browseResult = null;
  let visionResult = null;
  let imageReplyPath = null;
  let imageReplyCaption = null;
  let lastToolResult = null; // successful result from core, read, etc. — used when LLM doesn't echo it
  let voiceReplyText = null;
  let lastRoundHadToolError = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (!useTools) {
      const rawReply = await llmChat(messages);
      finalContent = stripThinking(rawReply);
      break;
    }
    let content;
    let toolCalls;
    let toolCallRetries = 0;
    while (toolCallRetries <= MAX_TOOL_CALL_RETRIES) {
      const response = await chatWithTools(messages, toolsToUse);
      content = response.content;
      toolCalls = response.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        finalContent = content || '';
        break;
      }
      if (validateToolCalls(toolCalls)) break;
      if (toolCallRetries >= MAX_TOOL_CALL_RETRIES) break;
      toolCallRetries++;
      console.log('[agent] invalid tool call arguments, retry', toolCallRetries, 'of', MAX_TOOL_CALL_RETRIES);
      messages = messages.concat({
        role: 'user',
        content: 'Your previous tool call had invalid or malformed arguments (missing or bad JSON, or missing required field "skill" for run_skill). Please call run_skill again with valid JSON, e.g. {"skill": "<skill_id>", "arguments": {...}}.',
      });
    }
    if (!toolCalls || toolCalls.length === 0) break;
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
      if (skillId === 'memory' && (toolName === 'memory_search') && !(runArgs.query && String(runArgs.query).trim())) {
        const q = (payload.query && String(payload.query).trim()) || (payload.q && String(payload.q).trim()) || '';
        if (q) runArgs.query = q;
      }
      if (skillId === 'vision' && !hasVisionImageArg(runArgs)) {
        const action = (runArgs?.action && String(runArgs.action).trim().toLowerCase()) || 'describe';
        if (action !== 'generate') {
          const extractedPath = extractImagePathFromMessage(userText) || getLastImagePathFromHistory(historyMessages);
          if (extractedPath) runArgs.image = extractedPath;
        }
      }
      const action = runArgs?.action && String(runArgs.action).trim().toLowerCase();
      if (!skillId) {
        const errContent = JSON.stringify({ error: 'run_skill requires "skill" and "arguments".' });
        lastRoundHadToolError = true;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: errContent });
        continue;
      }
      console.log('[agent] skill called:', skillId);
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
      if (skillId === 'browse' && result && typeof result === 'string' && !result.trim().startsWith('{"error":')) {
        browseResult = result;
      }
      if (skillId === 'vision' && result && typeof result === 'string' && !result.trim().startsWith('{"error":')) {
        visionResult = result;
        try {
          const parsed = JSON.parse(result);
          if (parsed?.imageReply?.path) {
            imageReplyPath = parsed.imageReply.path;
            imageReplyCaption = (parsed.imageReply.caption && String(parsed.imageReply.caption).trim()) || parsed.message || '';
          }
        } catch (_) {}
      }
      if (!isToolError && result && typeof result === 'string' && result.trim() && !result.trim().startsWith('{"error":')) {
        lastToolResult = result;
      }
      if (skillId === 'speech' && action === 'reply_as_voice' && !isToolError && runArgs.text && typeof runArgs.text === 'string') {
        voiceReplyText = String(runArgs.text).trim();
      }
      let toolContent = result;
      if (typeof getFullSkillDoc === 'function') {
        const fullDoc = getFullSkillDoc(skillId);
        if (fullDoc) toolContent = result + '\n\n---\nFull skill doc for ' + skillId + ':\n' + fullDoc;
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent });
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
  if (browseResult && !stripThinking(finalContent).trim()) {
    try {
      const synthesized = await chatWithTools(messages, []);
      const reply = synthesized?.content && stripThinking(synthesized.content).trim();
      if (reply) finalContent = reply;
    } catch (_) {}
  }
  if (visionResult && !stripThinking(finalContent).trim()) {
    try {
      const synthesized = await chatWithTools(messages, []);
      const reply = synthesized?.content && stripThinking(synthesized.content).trim();
      if (reply) finalContent = reply;
    } catch (_) {}
  }
  const looksLikeBrushOff = (s) => /^(Done\.?|Anything else\?|Done\.\s*Anything else\?)\s*$/i.test((s || '').trim());
  if (lastToolResult && (!stripThinking(finalContent).trim() || looksLikeBrushOff(finalContent))) {
    try {
      const { content: synthesized } = await chatWithTools(messages, []);
      const reply = synthesized && stripThinking(synthesized).trim();
      if (reply && !looksLikeBrushOff(reply)) finalContent = reply;
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
          reply = toUserMessage(err);
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
          reply = toUserMessage(err);
        }
      }
    } catch (_) {}
    reply = reply.slice(0, 2000) + (reply.length > 2000 ? '…' : '');
    textToSend = withPrefix(reply);
  } else if (browseResult && browseResult.trim()) {
    let reply = browseResult.trim();
    try {
      const parsed = JSON.parse(reply);
      if (parsed && typeof parsed.error === 'string') {
        const err = parsed.error;
        if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
          reply = "I couldn't run the browser because Playwright isn't set up. Run: pnpm exec playwright install";
        } else {
          reply = toUserMessage(err);
        }
      }
    } catch (_) {}
    reply = reply.slice(0, 2000) + (reply.length > 2000 ? '…' : '');
    textToSend = withPrefix(reply);
  } else if (visionResult && visionResult.trim()) {
    let reply = visionResult.trim();
    if (imageReplyPath) {
      reply = (imageReplyCaption && String(imageReplyCaption).trim())
        ? imageReplyCaption.slice(0, 2000) + (imageReplyCaption.length > 2000 ? '…' : '')
        : "Here's the image.";
    } else {
      try {
        const parsed = JSON.parse(reply);
        if (parsed && typeof parsed.error === 'string') {
          reply = toUserMessage(parsed.error);
        }
      } catch (_) {}
      reply = reply.slice(0, 2000) + (reply.length > 2000 ? '…' : '');
    }
    textToSend = withPrefix(reply);
  } else if (lastToolResult && lastToolResult.trim() && !lastToolResult.trim().startsWith('{"error":')) {
    let reply = lastToolResult.trim();
    try {
      const parsed = JSON.parse(reply);
      if (parsed && typeof parsed.error === 'string') reply = toUserMessage(parsed.error);
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
  return {
    textToSend: stripAsterisks(textToSend),
    voiceReplyText: voiceReplyText || undefined,
    imageReplyPath: imageReplyPath || undefined,
    imageReplyCaption: imageReplyCaption || undefined,
  };
}

