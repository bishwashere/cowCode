#!/usr/bin/env node
/**
 * Unit tests for conversation-context helpers (history in classifiers/probes).
 */

import {
  formatHistoryForClassifier,
  buildAnswerCompletenessProbePrompt,
  isReferentialFollowUp,
  getLastAssistantContent,
  shouldSkipForcedDelegation,
  enrichDelegationMessage,
} from '../../lib/conversation-context.js';

const HISTORY = [
  { role: 'user', content: 'Can we rename marketer to something lady name?' },
  { role: 'assistant', content: 'Here are options: 1) Maya 2) Chloe. Tell me your preference.' },
  { role: 'user', content: 'Chloe' },
  { role: 'assistant', content: 'Got it — Chloe. Want me to update the config?' },
];

const ARTICLE_HISTORY = [
  { role: 'user', content: 'ok prepare one such article' },
  {
    role: 'assistant',
    content: 'Title: Stop Writing AI News Recaps. Write This Instead\n\nIf your content calendar is full of "new AI model launched" posts, you are doing free PR for other companies.\n\nThose posts can get views, sure. But they rarely build trust with the people who will actually pay you.',
  },
];

function testFormatHistory() {
  const formatted = formatHistoryForClassifier(HISTORY, 2);
  if (!formatted.includes('Chloe')) throw new Error('history missing recent turns');
  if (!formatted.includes('Turn 1')) throw new Error('history missing turn labels');
}

function testProbeIncludesHistory() {
  const prompt = buildAnswerCompletenessProbePrompt('Chloe', 'Which Chloe do you mean?', HISTORY);
  if (!prompt.includes('Recent conversation')) throw new Error('probe missing history section');
  if (!prompt.includes('rename marketer')) throw new Error('probe missing prior user turn');
  if (!prompt.includes('complete')) throw new Error('probe missing JSON instruction');
}

function testReferentialFollowUpDetection() {
  if (!isReferentialFollowUp('revise it with some facts or numbers')) {
    throw new Error('expected revise-it to be referential');
  }
  if (!isReferentialFollowUp('not from idea section the one you suggested me that one')) {
    throw new Error('expected suggested-that-one to be referential');
  }
  if (isReferentialFollowUp('write 3 blog ideas for nextpostai.com')) {
    throw new Error('new task should not be referential');
  }
}

function testSkipForcedDelegation() {
  if (!shouldSkipForcedDelegation('revise it with some facts or numbers', ARTICLE_HISTORY)) {
    throw new Error('expected skip forced delegation when article is in history');
  }
  if (shouldSkipForcedDelegation('write 3 blog ideas for nextpostai.com', ARTICLE_HISTORY)) {
    throw new Error('new task should not skip delegation');
  }
}

function testEnrichDelegationMessage() {
  const enriched = enrichDelegationMessage('revise it with some facts or numbers', ARTICLE_HISTORY);
  if (!enriched.includes('Prior output from this conversation')) {
    throw new Error('enriched message missing prior output block');
  }
  if (!enriched.includes('Stop Writing AI News Recaps')) {
    throw new Error('enriched message missing article title');
  }
  const last = getLastAssistantContent(ARTICLE_HISTORY);
  if (!last.includes('Stop Writing AI News Recaps')) {
    throw new Error('getLastAssistantContent failed');
  }
}

async function main() {
  console.log('Conversation context helpers\n');
  const rows = [];
  let failed = 0;

  for (const [label, fn] of [
    ['formatHistoryForClassifier', testFormatHistory],
    ['buildAnswerCompletenessProbePrompt', testProbeIncludesHistory],
    ['isReferentialFollowUp', testReferentialFollowUpDetection],
    ['shouldSkipForcedDelegation', testSkipForcedDelegation],
    ['enrichDelegationMessage', testEnrichDelegationMessage],
  ]) {
    process.stdout.write(`  ${label} … `);
    try {
      fn();
      console.log('✅');
      rows.push({ test: label, result: '✅ Pass' });
    } catch (err) {
      console.log(`❌  ${err.message}`);
      rows.push({ test: label, result: '❌ Fail', detail: err.message });
      failed++;
    }
  }

  console.log('\n| Test | Result |');
  console.log('| --- | --- |');
  for (const r of rows) {
    console.log(`| \`${r.test}\` | ${r.result}${r.detail ? ' — ' + r.detail : ''} |`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
