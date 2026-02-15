#!/usr/bin/env node
/**
 * CLI entry: auth, moo start/stop/status/restart, or update.
 * Usage: cowcode auth | cowcode moo start|stop|status|restart | cowcode update
 */

import { spawn } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = process.env.COWCODE_INSTALL_DIR
  ? resolve(process.env.COWCODE_INSTALL_DIR)
  : __dirname;

const args = process.argv.slice(2);
const sub = args[0];

if (sub === 'moo') {
  const action = args[1];
  if (!action || !['start', 'stop', 'status', 'restart'].includes(action)) {
    console.log('Usage: cowcode moo start | stop | status | restart');
    process.exit(action ? 1 : 0);
  }
  const script = join(INSTALL_DIR, 'scripts', 'daemon.sh');
  if (!existsSync(script)) {
    console.error('cowCode: installation incomplete or corrupted.');
    console.error('  Re-run the installer:');
    console.error('  curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash');
    process.exit(1);
  }
  const child = spawn('bash', [script, action], {
    stdio: 'inherit',
    env: { ...process.env, COWCODE_INSTALL_DIR: INSTALL_DIR },
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else if (sub === 'auth' || (args.length === 1 && args[0] === '--auth-only')) {
  const authArgs = args[0] === '--auth-only' ? args : ['--auth-only', ...args.slice(1)];
  const child = spawn(process.execPath, [join(INSTALL_DIR, 'index.js'), ...authArgs], {
    stdio: 'inherit',
    env: process.env,
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else if (sub === 'update') {
  const script = join(INSTALL_DIR, 'update.sh');
  if (!existsSync(script)) {
    console.error('cowCode: update.sh not found. Re-run the installer.');
    console.error('  curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash');
    process.exit(1);
  }
  const updateArgs = args.slice(1).filter((a) => a === '--force' || a === '-f');
  const child = spawn('bash', [script, ...updateArgs], {
    stdio: 'inherit',
    env: { ...process.env, COWCODE_ROOT: INSTALL_DIR },
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else {
  console.log('Usage: cowcode moo start | stop | status | restart');
  console.log('       cowcode auth [options]');
  console.log('       cowcode update [--force]');
  process.exit(sub ? 1 : 0);
}
