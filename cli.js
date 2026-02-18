#!/usr/bin/env node
/**
 * CLI entry: auth, moo start/stop/status/restart, or update.
 * Usage: cowcode auth | cowcode moo start|stop|status|restart | cowcode update [--force]
 */

import { spawn, spawnSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = process.env.COWCODE_INSTALL_DIR
  ? resolve(process.env.COWCODE_INSTALL_DIR)
  : __dirname;

const args = process.argv.slice(2);
const sub = args[0];
const isForceUpdate = args.slice(1).some((a) => a === '--force' || a === '-f');

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
} else if (sub === 'dashboard') {
  const serverPath = join(INSTALL_DIR, 'dashboard', 'server.js');
  if (!existsSync(serverPath)) {
    console.error('cowCode: dashboard not found. Re-run the installer or run from repo.');
    process.exit(1);
  }
  const port = process.env.COWCODE_DASHBOARD_PORT || '3847';
  const host = process.env.COWCODE_DASHBOARD_HOST || '127.0.0.1';
  const url = `http://${host}:${port}`;
  const child = spawn(process.execPath, [serverPath], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, COWCODE_INSTALL_DIR: INSTALL_DIR },
    cwd: INSTALL_DIR,
  });
  child.unref();
  console.log('Dashboard starting in background.');
  console.log('URL:', url);
  setTimeout(() => {
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(openCmd, [url], { stdio: 'ignore' }).unref();
  }, 800);
  process.exit(0);
} else if (sub === 'auth' || (args.length === 1 && args[0] === '--auth-only')) {
  const authArgs = args[0] === '--auth-only' ? args : ['--auth-only', ...args.slice(1)];
  const child = spawn(process.execPath, [join(INSTALL_DIR, 'index.js'), ...authArgs], {
    stdio: 'inherit',
    env: process.env,
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else if (sub === 'update') {
  const branch = process.env.COWCODE_BRANCH || 'master';
  const env = { ...process.env, COWCODE_ROOT: INSTALL_DIR };

  if (isForceUpdate) {
    // Run latest update.sh from GitHub so --force works even when installed script is old
    const url = `https://raw.githubusercontent.com/bishwashere/cowCode/${branch}/update.sh?t=${Date.now()}`;
    const tmpScript = join(tmpdir(), `cowcode-update-${Date.now()}.sh`);
    const curl = spawnSync('curl', ['-fsSL', '-H', 'Cache-Control: no-cache', url, '-o', tmpScript], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
    if (curl.status !== 0) {
      console.error('cowCode: failed to fetch update script from GitHub.');
      process.exit(1);
    }
    const child = spawn('bash', [tmpScript, '--force'], {
      stdio: 'inherit',
      env: { ...env, COWCODE_ROOT: INSTALL_DIR },
      cwd: INSTALL_DIR,
    });
    child.on('close', (code) => {
      try {
        unlinkSync(tmpScript);
      } catch (_) {}
      process.exit(code ?? 0);
    });
  } else {
    const script = join(INSTALL_DIR, 'update.sh');
    if (!existsSync(script)) {
      console.error('cowCode: update.sh not found. Re-run the installer.');
      console.error('  curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash');
      process.exit(1);
    }
    const child = spawn('bash', [script], {
      stdio: 'inherit',
      env,
      cwd: INSTALL_DIR,
    });
    child.on('close', (code) => process.exit(code ?? 0));
  }
} else {
  console.log('Usage: cowcode moo start | stop | status | restart');
  console.log('       cowcode dashboard');
  console.log('       cowcode auth [options]');
  console.log('       cowcode update [--force]');
  process.exit(sub ? 1 : 0);
}
