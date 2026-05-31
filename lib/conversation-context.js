/**
 * Shared helpers for passing recent chat history into classifiers and probes.
 * Context comes from the last N exchanges in the turn — not from special routing rules.
 */

import { isWorkOrDiscoveryRequest } from './goals-context.js';
import { enrichMessageWithProjectContext } from './projects-context.js';
import { INCOHERENT_ANSWER_PROBE_HINT } from './user-reply-style.js';

const REFERENTIAL_FOLLOW_UP =
  /\b(it|that|this|the one|the same one|above|previous|you wrote|you suggested|you gave|you sent|you prepared|you shared|last (one|reply|message|article|post|draft)|the article|the post|the draft)\b/i;
const EDIT_FOLLOW_UP =
  /\b(revise|edit|rewrite|update|improve|shorten|expand|polish|fix|tweak|change)\b/i;
const MIN_PRIOR_ASSISTANT_CHARS = 80;
const MAX_DELEGATION_PRIOR_CHARS = 12000;

function normalizeText(s) {
  return String(s || '').trim();
}

/** True when the user refers to prior assistant output ("revise it", "that one you suggested"). */
export function isReferentialFollowUp(userText) {
  const text = normalizeText(userText);
  if (!text) return false;
  if (REFERENTIAL_FOLLOW_UP.test(text)) return true;
  if (EDIT_FOLLOW_UP.test(text) && text.length <= 140 && /\b(it|that|this|one)\b/i.test(text)) return true;
  return false;
}

/** Last assistant message from LLM-ordered chat history. */
export function getLastAssistantContent(historyMessages) {
  if (!Array.isArray(historyMessages) || !historyMessages.length) return '';
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    if (historyMessages[i]?.role === 'assistant') {
      return normalizeText(historyMessages[i].content);
    }
  }
  return '';
}

/**
 * Forced auto-delegation must not bypass caller history when the user means "revise/edit that".
 */
export function shouldSkipForcedDelegation(userText, historyMessages) {
  if (!isReferentialFollowUp(userText)) return false;
  return getLastAssistantContent(historyMessages).length >= MIN_PRIOR_ASSISTANT_CHARS;
}

function truncatePriorAssistant(text, maxLen = MAX_DELEGATION_PRIOR_CHARS) {
  const s = normalizeText(text);
  if (!s || s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 24)}\n\n… [truncated for length]`;
}

/**
 * Attach prior assistant output when delegating referential follow-ups (e.g. "revise it").
 * Also applies project-tracker enrichment when relevant.
 */
export function enrichDelegationMessage(userText, historyMessages = []) {
  const text = normalizeText(userText);
  let message = text;
  if (isReferentialFollowUp(text)) {
    const prior = getLastAssistantContent(historyMessages);
    if (prior.length >= MIN_PRIOR_ASSISTANT_CHARS) {
      message +=
        '\n\n[Prior output from this conversation (the user is referring to this):]\n' +
        truncatePriorAssistant(prior);
    }
  }
  return enrichMessageWithProjectContext(message, historyMessages);
}

/** Compact history snippet for intent planner / quality probes. */
export function formatHistoryForClassifier(historyMessages, maxExchanges = 3) {
  if (!Array.isArray(historyMessages) || historyMessages.length === 0) return '';
  const n = Math.max(1, Math.floor(Number(maxExchanges)) || 3);
  const pairs = [];
  let currentUser = null;
  for (const msg of historyMessages) {
    if (msg?.role === 'user') currentUser = normalizeText(msg.content);
    else if (msg?.role === 'assistant' && currentUser != null) {
      pairs.push({ user: currentUser, assistant: normalizeText(msg.content) });
      currentUser = null;
    }
  }
  const recent = pairs.slice(-n);
  if (!recent.length) return '';
  return recent
    .map((p, i) => `Turn ${i + 1}:\nUser: ${p.user.slice(0, 300)}\nAssistant: ${p.assistant.slice(0, 400)}`)
    .join('\n\n');
}

/** User prompt for the post-turn completeness probe (includes recent history). */
export function buildAnswerCompletenessProbePrompt(userText, assistantAnswer, historyMessages) {
  const historyBlock = formatHistoryForClassifier(historyMessages, 2);
  const historySection = historyBlock
    ? `Recent conversation:\n${historyBlock}\n\n`
    : '';
  const workHint = isWorkOrDiscoveryRequest(userText)
    ? '- The user asked to learn or continue **work** (find out, what is it about, etc.). Mark **incomplete** if the assistant only asked them to pick a source (GitHub vs path vs tracker) without using tools first when an **Active goal** or URL was available.\n'
    : '';
  return (
    `${historySection}` +
    `Latest user message: "${normalizeText(userText).slice(0, 300)}"\n\n` +
    `Assistant answered: "${normalizeText(assistantAnswer).slice(0, 300)}"\n\n` +
    `Given the recent conversation, does the answer fully address the latest message?\n` +
    `- Short replies (names, yes/no, confirmations) are usually complete when they follow clearly from the thread.\n` +
    workHint +
    '- Mark incomplete if the assistant should have used tools (web, github, files) but gave only clarifying questions.\n' +
    INCOHERENT_ANSWER_PROBE_HINT +
    '- Only mark complete if the user got a real answer grounded in findings.\n\n' +
    `Reply with exactly one of:\n{ "complete": true }\n{ "complete": false }`
  );
}
