#!/usr/bin/env node
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const stateDir = mkdtempSync(join(tmpdir(), 'cowcode-goals-'));
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    const {
      listGoals,
      getGoal,
      createGoal,
      updateGoal,
      listDueGoals,
      processDueGoalsInStore,
      runGoalTick,
      buildGoalTickPrompt,
      getGoalMemoryPath,
      readGoalMemory,
    } = await import('../../lib/goals.js');
    const { logTeamActivity } = await import('../../lib/team-activity.js');

    const created = createGoal({
      title: 'Ship goals feature',
      objective: 'Implement persistent goals with autonomous ticks',
      ownerAgentId: 'main',
      intervalMs: 30_000,
      subgoals: [
        { id: 'research', title: 'Research', status: 'doing', progress: 40, assignee: 'marketer', depends_on: [] },
      ],
    });
    assert(created.id && created.status === 'active', 'goal created as active');
    assert(Array.isArray(created.subgoals) && created.subgoals.length === 1, 'initial subgoals normalized');
    assert(Array.isArray(listGoals().goals) && listGoals().goals.length === 1, 'goal persisted');

    const prompt = buildGoalTickPrompt(created);
    assert(/Goal ID/.test(prompt) && /STRICT JSON/.test(prompt), 'goal tick prompt generated');
    assert(/1\) Review/.test(prompt), 'prompt includes review section');
    assert(/2\) Progress Evaluation/.test(prompt), 'prompt includes progress evaluation section');
    assert(/3\) Next Action Selection/.test(prompt), 'prompt includes next action selection section');
    assert(/4\) Delegation Check/.test(prompt), 'prompt includes delegation check section');
    assert(/5\) Reflection & Memory Update/.test(prompt), 'prompt includes reflection section');
    assert(/6\) User Input Check/.test(prompt), 'prompt includes user input check section');
    assert(/7\) Waiting \/ Watchers \/ Conditions/.test(prompt), 'prompt includes waiting section');
    assert(/8\) Opportunity Detection/.test(prompt), 'prompt includes opportunity detection section');
    assert(/"userInputRequired": false/.test(prompt), 'prompt includes user input required flag');
    assert(/"wait":/.test(prompt), 'prompt includes wait schema');
    assert(/"initiatives": \[\{/.test(prompt), 'prompt includes initiatives schema');
    const memoryPath = getGoalMemoryPath(created.id);
    assert(existsSync(memoryPath), 'goal memory file created');
    assert(/Per-goal memory file path/.test(prompt), 'prompt includes memory path');

    updateGoal(created.id, { nextRunAt: Date.now() - 1 });
    assert(listDueGoals().length === 1, 'goal is due');

    const runResult = await runGoalTick(created.id, {
      runGoalTurn: async () => ({
        textToSend: JSON.stringify({
          status: 'active',
          summary: 'Gathered evidence and updated plan.',
          progressPct: 42,
          evidence: ['checked team activity', 'drafted goals UI'],
          currentStep: 'Building dashboard tab',
          nextRunInSec: 45,
          contextSnapshot: 'UI and API partially implemented',
          memoryAnchors: ['goal=ship-goals', 'phase=ui'],
          learnings: ['Scoring should happen before planning'],
          decisions: ['Keep Team tab as default agent space'],
          userPreferences: ['Prefer concise status cards'],
          failedAttempts: ['Initial goals card had no owner badge'],
          planSteps: [
            { title: 'Implement store', status: 'done' },
            { title: 'Implement UI', status: 'doing' },
          ],
          subgoals: [
            {
              id: 'research',
              title: 'Research',
              status: 'done',
              progress: 100,
              assignee: 'marketer',
              depends_on: [],
              subgoals: [],
            },
            {
              id: 'calendar',
              title: 'Content Calendar',
              status: 'doing',
              progress: 35,
              assignee: 'main',
              depends_on: ['research'],
              subgoals: [
                {
                  id: 'production',
                  title: 'Production',
                  status: 'todo',
                  progress: 0,
                  assignee: 'main',
                  depends_on: ['calendar'],
                  subgoals: [
                    {
                      id: 'promotion',
                      title: 'Promotion',
                      status: 'todo',
                      progress: 0,
                      assignee: 'marketer',
                      depends_on: ['production'],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        skillsCalled: ['read', 'write'],
      }),
    });
    assert(runResult.goal.progress.pct === 42, `progress expected 42, got ${runResult.goal.progress.pct}`);
    assert(runResult.goal.lastActivity.includes('Gathered evidence'), 'summary persisted');
    assert(runResult.goal.running === false, 'goal not left running');
    assert(Array.isArray(runResult.goal.subgoals) && runResult.goal.subgoals.length === 2, 'goal subgoal tree saved');
    assert(runResult.goal.subgoals[1].depends_on.includes('research'), 'subgoal dependency saved');
    assert(runResult.goal.subgoals[1].subgoals[0].subgoals[0].title === 'Promotion', 'nested subgoal saved');
    assert(listGoals().goals.length === 1, 'single goal remains in store');
    const memoryAfterRun = readGoalMemory(created.id, { maxChars: 5000 });
    assert(/Learned:/.test(memoryAfterRun), 'memory stores learnings');
    assert(/Decisions:/.test(memoryAfterRun), 'memory stores decisions');
    assert(/User preferences:/.test(memoryAfterRun), 'memory stores user preferences');
    assert(/Did not work:/.test(memoryAfterRun), 'memory stores failed attempts');

    // Wait conditions: time-based waiting pauses due scheduling.
    updateGoal(created.id, { nextRunAt: Date.now() - 1 });
    const waitUntil = Date.now() + 120_000;
    await runGoalTick(created.id, {
      runGoalTurn: async () => ({
        textToSend: JSON.stringify({
          status: 'active',
          summary: 'Waiting for scheduled publish window.',
          progressPct: 42,
          wait: {
            kind: 'time',
            untilTs: waitUntil,
            reason: 'Await publish window opening',
          },
        }),
        skillsCalled: [],
      }),
    });
    const afterWaitTick = getGoal(created.id);
    assert(afterWaitTick.waitCondition && afterWaitTick.waitCondition.kind === 'time', 'time wait condition stored');
    assert(listDueGoals().length === 0, 'time-waiting goal is not due');

    // Wait conditions: team activity watchers wake goal when event appears.
    const watcherGoal = createGoal({
      title: 'Wait for content-ready signal',
      objective: 'Resume when team emits content-ready',
      ownerAgentId: 'main',
      intervalMs: 30_000,
      waitCondition: {
        kind: 'team_activity',
        eventType: 'content_ready',
        messageIncludes: 'phase 1',
        reason: 'Need team signal before resuming',
      },
      nextRunAt: Date.now() - 1,
    });
    const beforeSignalDue = processDueGoalsInStore({ maxPerCycle: 10 }).map((g) => g.id);
    assert(!beforeSignalDue.includes(watcherGoal.id), 'watcher goal not due before signal');
    logTeamActivity({ type: 'content_ready', message: 'phase 1 ready' });
    const afterSignalDue = processDueGoalsInStore({ maxPerCycle: 10 }).map((g) => g.id);
    assert(afterSignalDue.includes(watcherGoal.id), 'watcher goal becomes due after signal');
    const watcherAfterSignal = getGoal(watcherGoal.id);
    assert(!watcherAfterSignal.waitCondition, 'watch condition clears after signal');

    await runGoalTick(created.id, {
      runGoalTurn: async () => {
        throw new Error('network unavailable');
      },
    });
    const afterError = listGoals().goals.find((g) => g.id === created.id);
    assert(afterError.status === 'blocked', `status blocked after error, got ${afterError.status}`);
    const memoryAfterError = readFileSync(memoryPath, 'utf8');
    assert(/Tick failed/.test(memoryAfterError), 'memory stores failure notes');

    console.log('goals tests passed');
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
