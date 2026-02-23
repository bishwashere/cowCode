#!/usr/bin/env node
/**
 * CLI entry: auth, moo start/stop/status/restart, or update.
 * Usage: cowcode auth | cowcode moo start|stop|status|restart | cowcode logs | cowcode update [--force]
 */

import { spawn, spawnSync, execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir, homedir } from 'os';

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
  (async () => {
    const serverPath = join(INSTALL_DIR, 'dashboard', 'server.js');
    if (!existsSync(serverPath)) {
      console.error('cowCode: dashboard not found. Re-run the installer or run from repo.');
      process.exit(1);
    }
    const port = process.env.COWCODE_DASHBOARD_PORT || '3847';
    const host = process.env.COWCODE_DASHBOARD_HOST || '127.0.0.1';
    const url = `http://${host}:${port}`;
    try {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
      const pids = out.trim().split(/\s+/).filter(Boolean);
      if (pids.length) {
        for (const pid of pids) {
          try {
            process.kill(Number(pid), 'SIGTERM');
          } catch (_) {}
        }
        const list = pids.length === 1 ? `PID ${pids[0]}` : `PIDs ${pids.join(', ')}`;
        console.log('Stopped previous dashboard (' + list + ').');
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (_) {
      // No process on port (or lsof not available, e.g. Windows)
    }
    const child = spawn(process.execPath, [serverPath], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, COWCODE_INSTALL_DIR: INSTALL_DIR },
      cwd: INSTALL_DIR,
    });
    child.unref();
    console.log('Started dashboard at', url);
    console.log('(Refresh the page if you had it open.)');
    setTimeout(() => {
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(openCmd, [url], { stdio: 'ignore' }).unref();
    }, 800);
    process.exit(0);
  })();
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
} else if (sub === 'uninstall') {
  const script = join(INSTALL_DIR, 'uninstall.sh');
  if (!existsSync(script)) {
    console.error('cowCode: uninstall.sh not found. Re-run the installer.');
    console.error('  curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash');
    process.exit(1);
  }
  const child = spawn('bash', [script], {
    stdio: 'inherit',
    env: { ...process.env, COWCODE_INSTALL_DIR: INSTALL_DIR },
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else if (sub === 'logs') {
  const stateDir = process.env.COWCODE_STATE_DIR || join(homedir(), '.cowcode');
  const logPath = join(stateDir, 'daemon.log');
  if (process.platform === 'win32') {
    const child = spawn('pm2', ['logs', 'cowcode'], {
      stdio: 'inherit',
      env: process.env,
      cwd: INSTALL_DIR,
    });
    child.on('close', (code) => process.exit(code ?? 0));
  } else {
    if (!existsSync(logPath)) {
      console.error('cowCode: no log file yet. Start the bot with: cowcode moo start');
      process.exit(1);
    }
    const child = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
    child.on('close', (code) => process.exit(code ?? 0));
  }
} else if (sub === 'index') {
  const indexScript = join(INSTALL_DIR, 'scripts', 'index-cli.js');
  if (!existsSync(indexScript)) {
    console.error('cowcode: scripts/index-cli.js not found.');
    process.exit(1);
  }
  const child = spawn(process.execPath, [indexScript, ...args.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, COWCODE_STATE_DIR: process.env.COWCODE_STATE_DIR },
    cwd: INSTALL_DIR,
  });
  child.on('close', (code) => process.exit(code ?? 0));
} else if (sub === 'skills') {
  const skillSub = args[1];
  const skillArg = args[2];
  if (skillSub === 'install' && skillArg) {
    (async () => {
      try {
        const skillInstallPath = join(INSTALL_DIR, 'lib', 'skill-install.js');
        const mod = await import(pathToFileURL(skillInstallPath).href);
        const skillId = mod.normalizeSkillId(skillArg);
        const result = await mod.runSkillInstall(skillId, INSTALL_DIR);
        if (!result.ok) {
          console.error('cowCode:', result.message);
          process.exit(1);
        }
      } catch (err) {
        console.error('cowCode: skills install failed.', err?.message || err);
        process.exit(1);
      }
    })();
  } else {
    console.log('Usage: cowcode skills install <skill-id>');
    console.log('  Example: cowcode skills install home-assistant');
    console.log('  Installs a skill (adds to config) and prompts only for that skill\'s required env vars.');
    process.exit(skillSub === 'install' ? 1 : 0);
  }
} else {
  console.log('Usage: cowcode moo start | stop | status | restart');
  console.log('       cowcode logs');
  console.log('       cowcode dashboard');
  console.log('       cowcode index [full] [--source memory] [--source filesystem] [--root <path>] [--limit N]');
  console.log('       cowcode auth [options]');
  console.log('       cowcode skills install <skill-id>');
  console.log('       cowcode update [--force]');
  console.log('       cowcode uninstall');
  process.exit(sub ? 1 : 0);
}
