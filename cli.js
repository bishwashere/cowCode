#!/usr/bin/env node
/**
 * CLI entry: run bot, auth, or moo start/stop/status/restart.
 * Usage: cowcode [start] | cowcode auth | cowcode moo start|stop|status|restart
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = __dirname;

const args = process.argv.slice(2);
const sub = args[0];

if (sub === 'moo') {
  const action = args[1];
  if (!action || !['start', 'stop', 'status', 'restart'].includes(action)) {
    console.log('Usage: cowcode moo start | stop | status | restart');
    process.exit(action ? 1 : 0);
  }
  const script = join(INSTALL_DIR, 'scripts', 'daemon.sh');
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
} else {
  // default: run bot (with any extra args, e.g. --test)
  const child = spawn(process.execPath, [join(INSTALL_DIR, 'index.js'), ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
}
