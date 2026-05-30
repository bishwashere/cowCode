/**
 * Shared helpers for passing recent chat history into classifiers and probes.
 * Context comes from the last N exchanges in the turn — not from special routing rules.
 */

function normalizeText(s) {
  return String(s || '').trim();
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
  return (
    `${historySection}` +
    `Latest user message: "${normalizeText(userText).slice(0, 300)}"\n\n` +
    `Assistant answered: "${normalizeText(assistantAnswer).slice(0, 300)}"\n\n` +
    `Given the recent conversation, does the answer fully address the latest message?\n` +
    `- Short replies (names, yes/no, confirmations) are usually complete when they follow clearly from the thread.\n` +
    `- Only mark incomplete if real-time web information is genuinely missing.\n\n` +
    `Reply with exactly one of:\n{ "complete": true }\n{ "complete": false }`
  );
}
