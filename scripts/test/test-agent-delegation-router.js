#!/usr/bin/env node
/**
 * Unit tests for specialization-aware pre-routing to agent-send.
 */

import { createTempStateDir } from './e2e-run.js';
import { setupAgentTeamFixture, patchAgentConfig } from './agent-team-fixture.js';

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
  assert(typeof marketing?.recommendation?.confidence === 'number', 'Expected confidence score on recommendation');
  assert(
    (marketing?.recommendation?.reason || '').toLowerCase().includes('request contains'),
    `Expected natural-language reason, got: ${marketing?.recommendation?.reason || 'none'}`,
  );
  assert(Array.isArray(marketing?.candidates) && marketing.candidates.length >= 1, 'Expected ranked candidate list');

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

  const marketingTypo = buildDelegationContext({
    agentId: 'main',
    userText: 'what can be 3 blog ideas for marketting nextpostai.com',
    availableSkillIds,
  });
  assert(
    marketingTypo?.recommendation?.targetAgentId === 'marketer',
    `Expected marketer recommendation for marketing typo, got ${marketingTypo?.recommendation?.targetAgentId || 'none'}`,
  );

  await patchAgentConfig('main', { agentMessaging: { allow: ['marketer'] } });
  const alexNotLinked = buildDelegationContext({
    agentId: 'main',
    userText: "Can you check with Alex if he's around?",
    availableSkillIds,
  });
  assert(
    alexNotLinked?.recommendation?.targetAgentId === 'alex' && alexNotLinked?.recommendation?.blocked === true,
    `Expected blocked explicit alex recommendation, got ${JSON.stringify(alexNotLinked?.recommendation || null)}`,
  );

  console.log('agent-delegation-router tests passed');
}

run().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

