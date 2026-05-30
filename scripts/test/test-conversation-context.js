#!/usr/bin/env node
/**
 * Unit tests for conversation-context helpers (history in classifiers/probes).
 */

import {
  formatHistoryForClassifier,
  buildAnswerCompletenessProbePrompt,
} from '../../lib/conversation-context.js';

const HISTORY = [
  { role: 'user', content: 'Can we rename marketer to something lady name?' },
  { role: 'assistant', content: 'Here are options: 1) Maya 2) Chloe. Tell me your preference.' },
  { role: 'user', content: 'Chloe' },
  { role: 'assistant', content: 'Got it — Chloe. Want me to update the config?' },
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

async function main() {
  console.log('Conversation context helpers\n');
  const rows = [];
  let failed = 0;

  for (const [label, fn] of [
    ['formatHistoryForClassifier', testFormatHistory],
    ['buildAnswerCompletenessProbePrompt', testProbeIncludesHistory],
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
