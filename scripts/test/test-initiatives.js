#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const stateDir = mkdtempSync(join(tmpdir(), 'cowcode-initiatives-'));
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    const {
      createInitiatives,
      listInitiatives,
      updateInitiative,
      analyzeTeamActivityForInitiatives,
    } = await import('../../lib/initiatives.js');
    const { logTeamActivity } = await import('../../lib/team-activity.js');

    const first = createInitiatives([
      {
        title: 'Users stop after signup',
        type: 'risk',
        description: 'Drop-off is high immediately after signup.',
        confidence: 0.85,
      },
      {
        title: 'Low-confidence noise',
        type: 'observation',
        description: 'Should be discarded',
        confidence: 0.2,
      },
    ], {
      source: 'goal_reflection',
      createdBy: 'marketer',
      relatedGoalIds: ['goal-1'],
      minConfidence: 0.6,
      maxPerBatch: 3,
    });
    assert(first.created.length === 1, `expected 1 initiative created, got ${first.created.length}`);
    assert(first.discarded.includes('low_confidence'), 'low confidence candidate discarded');

    const dupe = createInitiatives([
      {
        title: 'Users stop after signup',
        type: 'risk',
        description: 'Same risk with different wording.',
        confidence: 0.9,
      },
    ], {
      source: 'waiting_goal',
      createdBy: 'main',
      relatedGoalIds: ['goal-2'],
      minConfidence: 0.6,
    });
    assert(dupe.created.length === 0, 'duplicate not created again');
    assert(dupe.merged.length === 1, 'duplicate merged');

    const all = listInitiatives().initiatives;
    assert(all.length === 1, `expected 1 initiative in store after merge, got ${all.length}`);
    const updated = updateInitiative(all[0].id, { status: 'accepted' });
    assert(updated.status === 'accepted', 'status update works');

    // Team activity analysis should synthesize repeated failures.
    logTeamActivity({ type: 'goal_tick_error', message: 'analytics data missing from warehouse' });
    logTeamActivity({ type: 'goal_tick_error', message: 'analytics data missing from warehouse' });
    logTeamActivity({ type: 'goal_tick_error', message: 'analytics data missing from warehouse' });
    const analysis = analyzeTeamActivityForInitiatives({ minIntervalMs: 0 });
    assert((analysis.created.length + analysis.merged.length) >= 1, 'team analysis created or merged initiative');

    console.log('initiatives tests passed');
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
