#!/usr/bin/env node
/**
 * Unit tests for specialization-aware pre-routing to agent-send.
 */

import { createTempStateDir } from './e2e-run.js';
import { setupAgentTeamFixture } from './agent-team-fixture.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function configureSpecialistSkills() {
  const { loadAgentConfig, saveAgentConfig, syncAgentSendSkillInConfig } = await import('../../lib/agent-config.js');

  const marketerCfg = loadAgentConfig('marketer');
  marketerCfg.skills = marketerCfg.skills || {};
  marketerCfg.skills.enabled = ['calendar', 'gmail'];
  syncAgentSendSkillInConfig(marketerCfg);
  saveAgentConfig('marketer', marketerCfg);

  const alexCfg = loadAgentConfig('alex');
  alexCfg.skills = alexCfg.skills || {};
  alexCfg.skills.enabled = ['github', 'go-read'];
  syncAgentSendSkillInConfig(alexCfg);
  saveAgentConfig('alex', alexCfg);
}

async function run() {
  const stateDir = createTempStateDir();
  process.env.COWCODE_STATE_DIR = stateDir;
  await setupAgentTeamFixture(stateDir);
  await configureSpecialistSkills();

  const { getEnabledSkillIds } = await import('../../skills/loader.js');
  const { buildDelegationContext } = await import('../../lib/agent-delegation-router.js');

  const availableSkillIds = getEnabledSkillIds({ agentId: 'main' });
  assert(availableSkillIds.includes('agent-send'), 'Expected main to have agent-send enabled');

  const marketing = buildDelegationContext({
    agentId: 'main',
    userText: 'I need a weekly content calendar and newsletter plan for our product launch.',
    availableSkillIds,
  });
  assert(marketing?.recommendation?.targetAgentId === 'marketer', `Expected marketer recommendation, got ${marketing?.recommendation?.targetAgentId || 'none'}`);

  const engineering = buildDelegationContext({
    agentId: 'main',
    userText: 'Can you investigate why our GitHub CI check is failing and propose a fix?',
    availableSkillIds,
  });
  assert(engineering?.recommendation?.targetAgentId === 'alex', `Expected alex recommendation, got ${engineering?.recommendation?.targetAgentId || 'none'}`);

  const greeting = buildDelegationContext({
    agentId: 'main',
    userText: 'Hi',
    availableSkillIds,
  });
  assert(greeting === null, 'Expected no delegation recommendation for greeting');

  console.log('agent-delegation-router tests passed');
}

run().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

