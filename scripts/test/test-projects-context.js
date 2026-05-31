#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const stateDir = mkdtempSync(join(tmpdir(), 'cowcode-proj-ctx-'));
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    const { createProject } = await import('../../lib/projects-db.js');
    const {
      buildProjectsContextBlock,
      formatProjectsForPrompt,
      formatProjectsProfileLine,
    } = await import('../../lib/projects-context.js');

    assert(formatProjectsForPrompt([]).includes('No projects'), 'empty list copy');
    createProject({
      name: 'NextPostAI',
      description: 'Improve onboarding conversion',
      url: 'https://nextpostai.com',
    });
    createProject({ name: 'Side app', description: '', url: '' });

    const block = buildProjectsContextBlock();
    assert(block.includes('Dashboard projects'), 'block header');
    assert(block.includes('NextPostAI'), 'includes name');
    assert(block.includes('nextpostai.com'), 'includes url');
    assert(block.includes('Do **not** say you do not know'), 'instruction');

    const profile = formatProjectsProfileLine();
    assert(profile.includes('2 project'), `profile count: ${profile}`);
    assert(profile.includes('NextPostAI'), 'profile name');

    console.log('projects-context tests passed');
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
