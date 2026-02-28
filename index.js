/**
 * WhatsApp + configurable LLM. On incoming message → LLM reply → send back.
 * Config and state live in ~/.cowcode (or COWCODE_STATE_DIR).
 */

import { getAuthDir, getCronStorePath, getConfigPath, getEnvPath, ensureStateDir, getWorkspaceDir, getUploadsDir, getStateDir, getGroupDir } from './lib/paths.js';
import dotenv from 'dotenv';

dotenv.config({ path: getEnvPath() });

// Log to daemon.log so "tail -f" shows when the process actually started (after cowcode moo start/restart)
console.log(`[${new Date().toISOString().replace(/\.\d{3}Z$/, '')}] cowCode daemon started`);

import * as Baileys from '@whiskeysockets/baileys';

const makeWASocket =
  typeof Baileys.makeWASocket === 'function' ? Baileys.makeWASocket : Baileys.default;
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  extractMessageContent,
  areJidsSameUser,
  downloadMediaMessage,
} = Baileys;
import { chat as llmChat, chatWithTools, loadConfig } from './llm.js';
import { runAgentTurn, stripThinking } from './lib/agent.js';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { spawn } from 'child_process';
import pino from 'pino';
import { startCron, stopCron, scheduleOneShot, runPastDueOneShots } from './cron/runner.js';
import { getSkillsEnabled, getSkillContext, DEFAULT_ENABLED } from './skills/loader.js';
import { initBot, createTelegramSock, isTelegramChatId, isTelegramGroupJid } from './lib/telegram.js';
import { isWhatsAppGroupJid } from './lib/whatsapp.js';
import { addPending as addPendingTelegram, clearPending as clearPendingTelegram } from './lib/pending-telegram.js';
import { getChannelsConfig } from './lib/channels-config.js';
import { getSchedulingTimeContext } from './lib/timezone.js';
import { getOwnerConfig, isOwner } from './lib/owner-config.js';
import { getGroupAddedBy, setGroupAddedBy } from './lib/telegram-group-added-by.js';
import { isTelegramGroup } from './lib/group-guard.js';
import { getMemoryConfig } from './lib/memory-config.js';
import { indexChatExchange } from './lib/memory-index.js';
import { appendGroupExchange, readLastGroupExchanges, readLastPrivateExchanges } from './lib/chat-log.js';
import { handleTelegramPrivateMessage } from './lib/telegram-private-handler.js';
import { handleTelegramGroupMessage } from './lib/telegram-group-handler.js';
import { ensureGroupConfigFor, readGroupMd } from './lib/group-config.js';
import { loadGroupMd, buildGroupPromptBlock } from './lib/group-prompt.js';
import { getGroupDisplayName, setGroupDisplayName, parseSetDisplayNameMessage } from './lib/group-display-names.js';
import { resetBrowseSession } from './lib/executors/browse.js';
import { toUserMessage } from './lib/user-error.js';
import { getSpeechConfig, transcribe, synthesizeToBuffer } from './lib/speech-client.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const qrcodeTerminal = require('qrcode-terminal');

const __dirname = dirname(fileURLToPath(import.meta.url));

if (typeof makeWASocket !== 'function') {
  throw new Error('Baileys makeWASocket not found. Check @whiskeysockets/baileys version.');
}

const authOnly = process.argv.includes('--auth-only');
const pairIndex = process.argv.indexOf('--pair');
const pairNumber = pairIndex !== -1 ? process.argv[pairIndex + 1] : null;

// Keys we never log (signal/session key material and noisy proto fields)
const REDACT_KEYS = new Set([
  'indexInfo', 'baseKey', 'baseKeyType', 'remoteIdentityKey', 'pendingPreKey',
  'signedKeyId', 'keyPair', 'private', 'public', 'signature', 'identifierKey',
]);

function redactForLog(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Buffer.isBuffer(obj) || (typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array)) return '[Buffer]';
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redactForLog(v);
  }
  return out;
}

// In auth mode show connection errors so we can see why linking fails
const pinoLogger = pino({ level: authOnly ? 'error' : 'silent' });
function logWithRedact(pinoInstance, level, a, b) {
  if (typeof a === 'string' && b === undefined) {
    pinoInstance[level](a);
    return;
  }
  const obj = typeof a === 'object' && a !== null ? redactForLog(a) : a;
  const msg = b;
  pinoInstance[level](obj, msg);
}

const logger = {
  get level() { return pinoLogger.level; },
  set level(v) { pinoLogger.level = v; },
  child(bindings) {
    return wrapForRedaction(pinoLogger.child(bindings));
  },
  trace(a, b) { logWithRedact(pinoLogger, 'trace', a, b); },
  debug(a, b) { logWithRedact(pinoLogger, 'debug', a, b); },
  info(a, b) { logWithRedact(pinoLogger, 'info', a, b); },
  warn(a, b) { logWithRedact(pinoLogger, 'warn', a, b); },
  error(a, b) { logWithRedact(pinoLogger, 'error', a, b); },
};

function writeDaemonStarted() {
  try {
    const path = join(getStateDir(), 'daemon.started');
    writeFileSync(path, JSON.stringify({ startedAt: Date.now() }), 'utf8');
  } catch (_) {}
}

function wrapForRedaction(pinoInstance) {
  return {
    get level() { return pinoInstance.level; },
    set level(v) { pinoInstance.level = v; },
    child(b) { return wrapForRedaction(pinoInstance.child(b)); },
    trace(a, b) { logWithRedact(pinoInstance, 'trace', a, b); },
    debug(a, b) { logWithRedact(pinoInstance, 'debug', a, b); },
    info(a, b) { logWithRedact(pinoInstance, 'info', a, b); },
    warn(a, b) { logWithRedact(pinoInstance, 'warn', a, b); },
    error(a, b) { logWithRedact(pinoInstance, 'error', a, b); },
  };
}

// Patch console so deps (e.g. Baileys WAM/encode) never log key material to stdout
const _consoleLog = console.log;
const _consoleInfo = console.info;
const _consoleDebug = console.debug;
const _consoleWarn = console.warn;
function redactConsoleArgs(args) {
  return args.map((a) => {
    if (a !== null && typeof a === 'object') return redactForLog(a);
    if (typeof a === 'string' && a.length > 200) {
      const t = a.trim();
      if (t.startsWith('{') || t.startsWith('[')) return a.slice(0, 60) + '… [truncated]';
    }
    return a;
  });
}
console.log = (...args) => _consoleLog(...redactConsoleArgs(args));
console.info = (...args) => _consoleInfo(...redactConsoleArgs(args));
console.debug = (...args) => _consoleDebug(...redactConsoleArgs(args));
console.warn = (...args) => _consoleWarn(...redactConsoleArgs(args));

const DISCONNECT_REASONS = {
  401: 'Logged out',
  403: 'Forbidden (e.g. banned)',
  408: 'Connection lost / timed out',
  411: 'Multi-device not enabled (enable in WhatsApp Settings → Linked devices)',
  428: 'Connection closed',
  440: 'Connection replaced (another client linked)',
  500: 'Bad session',
  503: 'WhatsApp service unavailable',
  515: 'Restart required (reconnecting…)',
};

const RESTART_REQUIRED_CODE = 515;

/** Codes for which we do not retry reconnect (user must re-auth). */
const NO_RETRY_CODES = new Set([401, 403]);

const RECONNECT_DELAYS_MS = [5000, 15000, 30000, 60000]; // exponential backoff, max 60s

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create WhatsApp socket with saved auth; resolves when connection is open, rejects if closed before open.
 * @returns {Promise<ReturnType<makeWASocket>>}
 */
async function connectWhatsApp() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());
  const keyStoreLogger = wrapForRedaction(pino({ level: 'silent' }));
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, keyStoreLogger),
    },
    logger,
  });
  sock.ev.on('creds.update', saveCreds);
  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'open') resolve(sock);
      if (u.connection === 'close' && u.lastDisconnect) {
        const code = u.lastDisconnect.error?.output?.statusCode ?? u.lastDisconnect.error?.statusCode;
        reject(Object.assign(new Error('closed'), { code }));
      }
    });
  });
}

/**
 * @param {{ continueToBot?: boolean }} opts - If true, after link we continue to run the bot (no exit).
 */
async function runAuthOnly(opts = {}) {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());

  const keyStoreLogger = wrapForRedaction(pino({ level: 'silent' }));
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, keyStoreLogger),
    },
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', async (u) => {
      if (u.connection === 'open') {
        if (opts.continueToBot) {
          console.log('[connection] connection successful');
          console.log('Please send a message to your own number to get started.');
        } else {
          console.log('[connection] connection successful');
          console.log('Linked. You can Ctrl+C and run cowcode moo start.');
        }
        resolve(sock);
        return;
      }
      if (u.connection === 'close' && u.lastDisconnect) {
        const err = u.lastDisconnect.error;
        const code = err?.output?.statusCode ?? err?.statusCode;
        const reason = DISCONNECT_REASONS[code] || `Code ${code}`;
        if (code === RESTART_REQUIRED_CODE) {
          try { sock.end(undefined); } catch (_) {}
          resolve('restart');
          return;
        }
        reject(new Error(reason));
        return;
      }
      if (u.qr) {
        qrcodeTerminal.generate(u.qr, { small: true });
        console.log('Scan with WhatsApp (Linked devices).');
      }
    });

    if (pairNumber) {
      const digits = pairNumber.replace(/\D/g, '');
      if (digits.length < 10) {
        reject(new Error('Usage: pnpm run auth -- --pair <full-phone-number> (e.g. 1234567890)'));
        return;
      }
      sock.requestPairingCode(digits)
        .then((code) => {
          console.log('Pairing code (enter in WhatsApp → Linked devices → Link with phone number):', code);
        })
        .catch((e) => reject(e));
    }
  });
}

/** Migration: ensure all default skills (cron, search, browse, vision, memory, speech, etc.) are in skills.enabled so new installs and updates get them without fresh install. */
function migrateSkillsConfigToIncludeDefaults() {
  try {
    const path = getConfigPath();
    if (!existsSync(path)) return;
    const raw = readFileSync(path, 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills || {};
    let enabled = Array.isArray(skills.enabled) ? skills.enabled : [];
    let changed = false;
    for (const id of DEFAULT_ENABLED) {
      if (!enabled.includes(id)) {
        enabled = [...enabled, id];
        changed = true;
      }
    }
    if (!changed) return;
    config.skills = { ...skills, enabled };
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) {}
}

async function main() {
  ensureStateDir();
  migrateSkillsConfigToIncludeDefaults();
  if (authOnly && existsSync(getAuthDir())) {
    rmSync(getAuthDir(), { recursive: true });
    mkdirSync(getAuthDir(), { recursive: true });
  }

  if (authOnly) {
    while (true) {
      try {
        const result = await runAuthOnly();
        if (result !== 'restart') break;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
    }
    return;
  }

  let sock;
  const channelsConfig = getChannelsConfig();
  const envTelegramOnly = process.env.COWCODE_TELEGRAM_ONLY === '1' || process.env.COWCODE_TELEGRAM_ONLY === 'true';
  const telegramOnlyMode = (envTelegramOnly || (channelsConfig.telegram.enabled && !channelsConfig.whatsapp.enabled)) && !!channelsConfig.telegram.botToken;
  const credsPath = join(getAuthDir(), 'creds.json');
  const needAuth = !existsSync(getAuthDir()) || !existsSync(credsPath);

  // E2E tests need the mock socket regardless of channel config.
  if (process.argv.includes('--test')) {
    sock = {
      sendMessage: async () => ({ key: { id: 'test-' + Date.now() } }),
      sendPresenceUpdate: async () => {},
      readMessages: async () => {},
    };
  } else if (telegramOnlyMode) {
    sock = null;
  } else if (needAuth) {
    console.log('');
    console.log('  ─────────────────────────────────────────');
    console.log('  Link your WhatsApp');
    console.log('  ─────────────────────────────────────────');
    console.log('');
    console.log('  No session found. A QR code will appear below.');
    console.log('  Open WhatsApp → Linked devices → Link a device, then scan the code.');
    console.log('');
    while (true) {
      try {
        const result = await runAuthOnly({ continueToBot: true });
        if (result !== 'restart') {
          sock = result;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
    }
  } else {
    sock = null; // will be set by connectWhatsApp() in the reconnect loop below
  }

  /** Set in runBot (WhatsApp: initBot; Telegram-only: opts); null in --test so cron ctx does not throw. */
  let telegramBot = null;

  /** Returns a function that resolves to the given bot's username (cached after first getMe()). */
  function createGetBotUsername(bot) {
    let cached = undefined;
    return async function getBotUsername() {
      if (!bot) return null;
      if (cached !== undefined) return cached;
      try {
        const me = await bot.getMe();
        cached = me.username ?? null;
        return cached;
      } catch {
        cached = null;
        return null;
      }
    };
  }

  const config = loadConfig();
  const first = config.models[0];
  console.log('LLM config:', config.models.length > 1
    ? `${config.models.length} models (priority): ${config.models.map(m => m.model).join(' → ')}`
    : { baseUrl: first.baseUrl, model: first.model });
  const skillsEnabled = getSkillsEnabled();
  console.log('Skills enabled:', skillsEnabled?.length ? skillsEnabled.join(', ') : 'cron (default)');

  const MAX_REPLIED_IDS = 500;
  const MAX_OUR_SENT_IDS = 200;
  const MAX_CHAT_HISTORY_EXCHANGES = Math.max(1, Math.floor(Number(config.chatHistoryExchanges)) || 5);

  /** Pending WhatsApp replies when send failed (e.g. disconnected); flushed when connection reopens. */
  const pendingReplies = [];

  /** Last N exchanges (user + assistant) per jid for LLM context. Step 1: chat + history + tools. */
  const chatHistoryByJid = new Map();
  function getLast5Exchanges(jid) {
    const list = chatHistoryByJid.get(jid);
    if (!list || list.length === 0) return [];
    const out = [];
    for (const ex of list) {
      out.push({ role: 'user', content: ex.user });
      out.push({ role: 'assistant', content: ex.assistant });
    }
    return out;
  }
  function pushExchange(jid, userContent, assistantContent) {
    let list = chatHistoryByJid.get(jid);
    if (!list) list = [];
    list.push({ user: userContent, assistant: assistantContent });
    if (list.length > MAX_CHAT_HISTORY_EXCHANGES) list = list.slice(-MAX_CHAT_HISTORY_EXCHANGES);
    chatHistoryByJid.set(jid, list);
  }

  // Agent logic: getSkillContext() called on every run; compact list in tool; full doc injected when a skill is called.

  /** Tide: periodic check in its own process (does not block chat). Reply sent to tide.jid like cron. */
  let tideIntervalId = null;
  async function runTide() {
    let config = {};
    try {
      const raw = readFileSync(getConfigPath(), 'utf8');
      if (raw?.trim()) config = JSON.parse(raw);
    } catch (_) {}
    const tide = config.tide || {};
    if (!tide.enabled) return;
    const tideJid = tide.jid && String(tide.jid).trim() ? String(tide.jid).trim() : null;
    if (!tideJid || !sock?.sendMessage) return;
    const payload = JSON.stringify({
      jid: tideJid,
      storePath: getCronStorePath(),
      workspaceDir: getWorkspaceDir(),
    });
    let textToSend = '';
    try {
      textToSend = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['cron/run-tide.js'], {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'inherit'],
          env: { ...process.env, COWCODE_STATE_DIR: process.env.COWCODE_STATE_DIR },
        });
        let out = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.on('exit', (code, signal) => {
          if (code !== 0 && code != null) {
            reject(new Error(`run-tide exited with code ${code}`));
            return;
          }
          if (signal) {
            reject(new Error(`run-tide killed: ${signal}`));
            return;
          }
          const lastLine = out.trim().split('\n').filter(Boolean).pop() || '';
          try {
            const parsed = JSON.parse(lastLine);
            if (parsed.error) reject(new Error(parsed.error));
            else resolve(parsed.textToSend || '');
          } catch (e) {
            reject(new Error(lastLine.slice(0, 100) || e.message || 'run-tide invalid output'));
          }
        });
        child.on('error', reject);
        child.stdin.end(payload, 'utf8');
      });
    } catch (e) {
      console.error('[tide]', e.message);
      return;
    }
    const text = (textToSend || '').trim();
    const nothingPhrases = /^(nothing|n\/?a|no(ne)?\s*to\s*do|all\s*good|nothing\s*to\s*report\.?)\s*\.?$/i;
    if (!text || (text.length < 50 && nothingPhrases.test(text))) return;
    try {
      await sock.sendMessage(tideJid, { text });
      console.log('[tide] Sent to', tideJid.slice(0, 20) + (tideJid.length > 20 ? '…' : ''));
    } catch (e) {
      console.error('[tide] Send failed:', e.message);
    }
  }
  function startTide(sockRef, selfJidRef) {
    let config = {};
    try {
      const raw = readFileSync(getConfigPath(), 'utf8');
      if (raw?.trim()) config = JSON.parse(raw);
    } catch (_) {}
    const tide = config.tide || {};
    if (!tide.enabled) return;
    if (tideIntervalId) clearInterval(tideIntervalId);
    const intervalMinutes = Math.max(1, Number(tide.intervalMinutes) || 30);
    const intervalMs = intervalMinutes * 60 * 1000;
    tideIntervalId = setInterval(() => {
      runTide().catch((e) => console.error('[tide]', e.message));
    }, intervalMs);
    console.log('[tide] Started: every', intervalMinutes, 'minutes' + (tide.jid ? ' → ' + String(tide.jid).slice(0, 25) + '…' : ' (no jid; run only)'));
  }
  function stopTide() {
    if (tideIntervalId) {
      clearInterval(tideIntervalId);
      tideIntervalId = null;
      console.log('[tide] Stopped.');
    }
  }

  const WHO_AM_I_MD = 'WhoAmI.md';
  const MY_HUMAN_MD = 'MyHuman.md';
  const SOUL_MD = 'SOUL.md';
  const GROUP_MD = 'group.md';

  const WORKSPACE_DEFAULT_FILES = [WHO_AM_I_MD, MY_HUMAN_MD, SOUL_MD, GROUP_MD];
  const INSTALL_DIR = (process.env.COWCODE_INSTALL_DIR && resolve(process.env.COWCODE_INSTALL_DIR)) || __dirname;
  const DEFAULT_WORKSPACE_DIR = join(INSTALL_DIR, 'workspace-default');

  function readWorkspaceMd(filename) {
    const p = join(getWorkspaceDir(), filename);
    try {
      if (existsSync(p)) return readFileSync(p, 'utf8').trim();
    } catch (_) {}
    return '';
  }

  /** Copy repo workspace-default/*.md into state workspace if they don't exist. */
  function ensureWorkspaceDefaults() {
    try {
      ensureStateDir();
      const workspaceDir = getWorkspaceDir();
      for (const name of WORKSPACE_DEFAULT_FILES) {
        const dest = join(workspaceDir, name);
        if (existsSync(dest)) continue;
        const src = join(DEFAULT_WORKSPACE_DIR, name);
        if (existsSync(src)) copyFileSync(src, dest);
      }
    } catch (err) {
      console.error('[workspace] could not copy default files:', err.message);
    }
  }

  function ensureSoulMd() {
    ensureWorkspaceDefaults();
  }

  /** Read initial soul from workspace-default/SOUL.md when workspace/group have no SOUL.md. */
  function readDefaultSoul() {
    const p = join(DEFAULT_WORKSPACE_DIR, SOUL_MD);
    try {
      if (existsSync(p)) return readFileSync(p, 'utf8').trim();
    } catch (_) {}
    return '';
  }

  function getBioFromConfig() {
    try {
      const raw = readFileSync(getConfigPath(), 'utf8');
      const full = JSON.parse(raw);
      return full.bio || null;
    } catch (_) {
      return null;
    }
  }

  function isBioSet() {
    if (readWorkspaceMd(WHO_AM_I_MD) || readWorkspaceMd(MY_HUMAN_MD)) return true;
    const bio = getBioFromConfig();
    if (bio == null) return false;
    if (typeof bio === 'string') return (bio || '').trim() !== '';
    return typeof bio === 'object' && (bio.userName != null || bio.prompt != null);
  }

  function saveBioToConfig(paragraph) {
    const text = (paragraph || '').trim() || '';
    try {
      const path = getConfigPath();
      const raw = existsSync(path) ? readFileSync(path, 'utf8') : '{}';
      const config = raw.trim() ? JSON.parse(raw) : {};
      config.bio = text;
      writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('[bio] save failed:', err.message);
    }
    if (text) {
      try {
        ensureStateDir();
        const whoAmIPath = join(getWorkspaceDir(), WHO_AM_I_MD);
        writeFileSync(whoAmIPath, text, 'utf8');
      } catch (err) {
        console.error('[bio] could not write WhoAmI.md:', err.message);
      }
    }
  }

  const BIO_CONFIRM_PROMPT = "Hey, we haven't done some basic setup. Do you want to do it now?";
  const BIO_PROMPT =
    "Before we continue — I'd like to know you a bit. Please answer in one message (any format is fine):\n\nWhat is my name?\nWhat is your name?\nWho am I?\nWho are you?";

  function isYesReply(text) {
    const t = (text || '').trim().toLowerCase();
    return /^(y|yes|yeah|yep|sure|ok|okay|1|do it|please|go ahead|sounds good)$/.test(t) || t === 'yup';
  }

  function buildSystemPrompt(opts = {}) {
    const forGroup = !!opts.groupSenderName;
    const groupJid = opts.groupJid || 'default';
    if (forGroup) {
      ensureGroupConfigFor(groupJid);
    } else {
      ensureSoulMd();
    }
    const timeCtx = getSchedulingTimeContext();
    const timeBlock = `\n\n${timeCtx.timeContextLine}\nCurrent time UTC (for scheduling "at"): ${timeCtx.nowIso}. Examples: "in 1 minute" = ${timeCtx.in1min}; "in 2 minutes" = ${timeCtx.in2min}; "in 3 minutes" = ${timeCtx.in3min}.`;
    const workspaceDir = forGroup ? getGroupDir(groupJid) : getWorkspaceDir();
    const pathsLine = forGroup
      ? ''
      : `\n\nCowCode on this system: state dir ${getStateDir()}, workspace ${workspaceDir}. When the user asks where cowcode is installed or where config is, use the read skill with path \`~/.cowcode/config.json\` (or the state dir path above) to show config and confirm.`;
    let soulContent = forGroup
      ? (readGroupMd(SOUL_MD, groupJid) || readWorkspaceMd(SOUL_MD) || readDefaultSoul())
      : (readWorkspaceMd(SOUL_MD) || readDefaultSoul()) + pathsLine;
    if (forGroup) {
      const loaded = loadGroupMd(getWorkspaceDir(), DEFAULT_WORKSPACE_DIR);
      const groupBlock = buildGroupPromptBlock(loaded, {
        groupSenderName: opts.groupSenderName,
        groupMentioned: !!opts.groupMentioned,
        groupNonOwner: !!opts.groupNonOwner,
      });
      if (groupBlock) soulContent += '\n\n' + groupBlock;
    }
    let whoAmIContent = forGroup ? readGroupMd(WHO_AM_I_MD, groupJid) : readWorkspaceMd(WHO_AM_I_MD);
    const myHumanContent = forGroup ? readGroupMd(MY_HUMAN_MD, groupJid) : readWorkspaceMd(MY_HUMAN_MD);
    if (!forGroup && !whoAmIContent && !myHumanContent) {
      const bio = getBioFromConfig();
      const bioText = typeof bio === 'string' && (bio || '').trim() ? bio.trim() : null;
      if (bioText) {
        try {
          ensureStateDir();
          const whoAmIPath = join(getWorkspaceDir(), WHO_AM_I_MD);
          if (!existsSync(whoAmIPath)) {
            writeFileSync(whoAmIPath, bioText, 'utf8');
            whoAmIContent = bioText;
          }
        } catch (_) {}
      }
    }
    let identityBlock = '';
    if (whoAmIContent || myHumanContent) {
      if (whoAmIContent) identityBlock += '\n\n' + whoAmIContent;
      if (myHumanContent) identityBlock += '\n\n' + myHumanContent;
    } else if (!forGroup) {
      const bio = getBioFromConfig();
      if (bio != null) {
        if (typeof bio === 'string' && bio.trim()) {
          identityBlock = '\n\n' + bio.trim();
        } else if (typeof bio === 'object' && (bio.userName || bio.assistantName || bio.whoAmI || bio.whoAreYou)) {
          const parts = [];
          if (bio.userName) parts.push(`The user's name is ${bio.userName}.`);
          if (bio.assistantName) parts.push(`Your name is ${bio.assistantName}.`);
          if (bio.whoAmI) parts.push(`The user describes themselves: ${bio.whoAmI}.`);
          if (bio.whoAreYou) parts.push(`You describe yourself: ${bio.whoAreYou}.`);
          if (parts.length) identityBlock = '\n\n' + parts.join(' ');
        }
      }
    }
    const base = soulContent + identityBlock;
    return base + timeBlock;
  }

  async function runAgentWithSkills(sock, jid, text, lastSentByJidMap, selfJidForCron, ourSentIdsRef, bioOpts = {}) {
    console.log('[agent] handling:', text.slice(0, 50) + (text.length > 50 ? '…' : ''));
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (_) {}
    const isGroupJid = isTelegramGroupJid(jid) || isWhatsAppGroupJid(jid);
    const ctx = {
      storePath: getCronStorePath(),
      jid,
      workspaceDir: getWorkspaceDir(),
      scheduleOneShot,
      startCron: () => startCron({ sock, selfJid: selfJidForCron, storePath: getCronStorePath(), telegramBot: telegramBot || undefined }),
      groupNonOwner: !!bioOpts.groupNonOwner,
      isGroup: isGroupJid,
    };
    const isGroupNonOwner = !!bioOpts.groupNonOwner;
    const skillContext = isGroupNonOwner
      ? getSkillContext({ groupNonOwner: true, groupJid: jid })
      : getSkillContext();
    const toolsForRequest = Array.isArray(skillContext.runSkillTool) && skillContext.runSkillTool.length > 0
      ? skillContext.runSkillTool
      : [];
    const systemPromptOpts = isGroupNonOwner
      ? {
          groupSenderName: bioOpts.groupSenderName,
          groupJid: jid,
          groupMentioned: !!bioOpts.groupMentioned,
          groupNonOwner: true,
        }
      : { groupSenderName: bioOpts.groupSenderName };
    const inMemoryHistory = getLast5Exchanges(jid);
    const historyMessages = isGroupJid
      ? readLastGroupExchanges(getWorkspaceDir(), jid, MAX_CHAT_HISTORY_EXCHANGES)
      : (inMemoryHistory.length > 0 ? inMemoryHistory : readLastPrivateExchanges(getWorkspaceDir(), jid, MAX_CHAT_HISTORY_EXCHANGES));
    const { textToSend, voiceReplyText, imageReplyPath, imageReplyCaption } = await runAgentTurn({
      userText: text,
      ctx,
      systemPrompt: buildSystemPrompt(systemPromptOpts),
      tools: toolsForRequest,
      historyMessages,
      getFullSkillDoc: skillContext.getFullSkillDoc,
    });
    const textForSend = isTelegramChatId(jid) ? textToSend.replace(/^\[CowCode\]\s*/i, '').trim() : textToSend;
    const isGroupNoReply = bioOpts.groupNonOwner && !bioOpts.groupMentioned &&
      !(voiceReplyText && voiceReplyText.trim()) &&
      (!textForSend || !textForSend.trim() || /^\[NO_REPLY\]\s*$/i.test(textForSend.trim()));
    if (!isGroupNoReply) {
      let voiceBuffer = null;
      let imageBuffer = null;
      if (imageReplyPath && existsSync(imageReplyPath)) {
        try {
          imageBuffer = readFileSync(imageReplyPath);
        } catch (err) {
          console.error('[vision] read image failed:', err.message);
        }
      }
      const textForVoice = (voiceReplyText && voiceReplyText.trim()) ? voiceReplyText.trim() : null;
      if (textForVoice && !imageBuffer) {
        try {
          const speechConfig = getSpeechConfig();
          if (speechConfig?.elevenLabsApiKey) {
            voiceBuffer = await synthesizeToBuffer(speechConfig.elevenLabsApiKey, textForVoice, speechConfig.defaultVoiceId);
          }
        } catch (err) {
          console.error('[speech] synthesize failed:', err.message);
        }
      }
      const replyText = (voiceReplyText && voiceReplyText.trim()) ? voiceReplyText.trim() : textForSend;
      const captionForImage = (replyText && replyText.trim()) ? replyText.replace(/^\[CowCode\]\s*/i, '').trim() : (imageReplyCaption || '');
      try {
        let sent;
        if (voiceBuffer) {
          sent = await sock.sendMessage(jid, isTelegramChatId(jid) ? { voice: voiceBuffer } : { audio: voiceBuffer, ptt: true });
        } else if (imageBuffer) {
          sent = await sock.sendMessage(jid, isTelegramChatId(jid)
            ? { image: imageBuffer, caption: captionForImage }
            : { image: imageBuffer, caption: captionForImage, mimetype: 'image/png' });
        } else {
          sent = await sock.sendMessage(jid, { text: replyText });
        }
        if (sent?.key?.id && ourSentIdsRef?.current) {
          ourSentIdsRef.current.add(sent.key.id);
          if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
            const first = ourSentIdsRef.current.values().next().value;
            if (first) ourSentIdsRef.current.delete(first);
          }
        }
        lastSentByJidMap.set(jid, replyText);
        pushExchange(jid, text, replyText);
        const ts = Date.now();
        const exchange = { user: text, assistant: replyText, timestampMs: ts, jid };
        if (bioOpts.logExchange) {
          bioOpts.logExchange(exchange);
        } else {
          if (isGroupJid) {
            try {
              appendGroupExchange(getWorkspaceDir(), jid, exchange);
            } catch (err) {
              console.error('[group-chat-log] write failed:', err.message);
            }
          } else {
            const memoryConfig = getMemoryConfig();
            if (memoryConfig) {
              const indexPromise = indexChatExchange(memoryConfig, exchange).catch((err) =>
                console.error('[memory] auto-index failed:', err.message)
              );
              if (process.argv.includes('--test')) await indexPromise;
            }
          }
        }
        console.log('[replied]', toolsForRequest.length > 0 ? '(agent + skills)' : '(chat)');
        const alreadySentBioPrompt = bioOpts.bioPromptSentJids?.has(jid);
        if (bioOpts.pendingBioConfirmJids != null && !isBioSet() && !alreadySentBioPrompt) {
          try {
            await sock.sendMessage(jid, { text: BIO_CONFIRM_PROMPT });
            bioOpts.pendingBioConfirmJids.add(jid);
            bioOpts.bioPromptSentJids?.add(jid);
          } catch (_) {
            if (isTelegramChatId(jid)) addPendingTelegram(jid, BIO_CONFIRM_PROMPT);
            else pendingReplies.push({ jid, text: BIO_CONFIRM_PROMPT });
            bioOpts.pendingBioConfirmJids.add(jid);
            bioOpts.bioPromptSentJids?.add(jid);
          }
        }
      } catch (sendErr) {
        lastSentByJidMap.set(jid, replyText); // E2E can still assert on intended reply when send fails
        if (!isTelegramChatId(jid)) {
          pendingReplies.push({ jid, text: replyText });
          console.log('[replied] queued (send failed, will retry after reconnect):', sendErr.message);
        } else {
          addPendingTelegram(jid, replyText);
          console.log('[replied] Telegram queued (send failed, will retry on next message):', sendErr.message);
        }
      }
    }
  }

  // --test: run main code path once with mock socket (set above), then exit. No WhatsApp auth.
  // E2E tests capture stdout and parse E2E_REPLY_START...E2E_REPLY_END to assert on the reply.
  if (process.argv.includes('--test')) {
    const testIdx = process.argv.indexOf('--test');
    const testMsg1 = process.argv[testIdx + 1] || process.env.TEST_MESSAGE || 'Send me hello in 1 minute';
    const testMsg2 = process.env.TEST_MESSAGE_2;
    const lastSent = new Map();
    const sentIds = { current: new Set() };
    for (const [i, testMsg] of [testMsg1, testMsg2].filter(Boolean).entries()) {
      console.log('[test] Running main code path with message', i + 1 + ':', testMsg.slice(0, 60));
      try {
        await runAgentWithSkills(sock, 'test@s.whatsapp.net', testMsg, lastSent, 'test@s.whatsapp.net', sentIds);
      } catch (err) {
        lastSent.set('test@s.whatsapp.net', 'Moo — ' + (err && err.message ? err.message : String(err)));
      }
      const reply = lastSent.get('test@s.whatsapp.net');
      if (reply != null && (testMsg2 ? (i === 1) : true)) {
        console.log('E2E_REPLY_START');
        process.stdout.write(reply + '\n');
        console.log('E2E_REPLY_END');
      }
    }
    console.log('[test] Done. Check cron/jobs.json.');
    process.exit(0);
  }

  // Telegram-only mode: no WhatsApp; run only Telegram bot and cron.
  if (telegramOnlyMode) {
    const telegramToken = channelsConfig.telegram.botToken;
    const telegramBot = initBot(telegramToken);
    const telegramSock = createTelegramSock(telegramBot);
    console.log('');
    console.log('  ─────────────────────────────────────────');
    console.log('  Running in Telegram-only mode');
    console.log('  ─────────────────────────────────────────');
    console.log('');
    runBot(telegramSock, { telegramOnly: true, telegramBot });
    return;
  }

  async function runBot(sock, opts = {}) {
    const { telegramOnly, telegramBot: optsTelegramBot } = opts;
    if (telegramOnly && optsTelegramBot) {
      telegramBot = optsTelegramBot;
      writeDaemonStarted();
      startCron({ storePath: getCronStorePath(), telegramBot: optsTelegramBot });
      startTide(sock, null);
      const lastSentByJid = new Map();
      const ourSentMessageIds = new Set();
      const telegramRepliedIds = new Set();
      const pendingBioJids = new Set();
      const pendingBioConfirmJids = new Set();
      const bioPromptSentJidsTelegram = new Set();
      const MAX_TELEGRAM_REPLIED = 500;
      const telegramCtx = {
        bot: optsTelegramBot,
        sock,
        getChannelsConfig,
        getSpeechConfig,
        getUploadsDir,
        transcribe,
        clearPendingTelegram,
        addPendingTelegram,
        getOwnerConfig,
        isOwner,
        pendingBioConfirmJids,
        pendingBioJids,
        bioPromptSentJids: bioPromptSentJidsTelegram,
        saveBioToConfig,
        telegramRepliedIds,
        MAX_TELEGRAM_REPLIED,
        resetBrowseSession,
        runPastDueOneShots,
        runAgentWithSkills,
        lastSentByJid,
        ourSentMessageIds,
        getMemoryConfig,
        indexChatExchange,
        getWorkspaceDir,
        toUserMessage,
        getBotUsername: createGetBotUsername(optsTelegramBot),
        getGroupPromptMessages: () => loadGroupMd(getWorkspaceDir(), DEFAULT_WORKSPACE_DIR).messages,
      };
      optsTelegramBot.on('message', async (msg) => {
        if (isTelegramGroup(msg.chat)) {
          await handleTelegramGroupMessage(msg, telegramCtx);
        } else {
          await handleTelegramPrivateMessage(msg, telegramCtx);
        }
      });
      return;
    }

    console.log('');
    console.log('  ─────────────────────────────────────────');
    console.log('  Connecting to WhatsApp');
    console.log('  ─────────────────────────────────────────');
    console.log('');

    let telegramSock = null;
    const telegramToken = getChannelsConfig().telegram.botToken;
    // Only init and log Telegram when configured; when not set up we don't show or log anything about Telegram.
    if (telegramToken) {
      telegramBot = initBot(telegramToken);
      telegramSock = createTelegramSock(telegramBot);
      console.log('  Telegram bot enabled.');
      console.log('');
    }

    sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') {
      console.log('  [connection] connection successful');
      writeDaemonStarted();
      const sid = sock.user?.id ?? selfJid;
      if (sid) selfJid = sid;
      console.log('  WhatsApp connected. Message your own number to start chatting.');
      console.log('');
      if (sid) {
        startCron({ sock, selfJid: sid, storePath: getCronStorePath(), telegramBot: telegramBot || undefined });
        startTide(sock, sid);
      }
      // Flush replies that failed to send while disconnected
      while (pendingReplies.length > 0) {
        const { jid, text } = pendingReplies.shift();
        sock.sendMessage(jid, { text }).catch((e) => console.error('[pending] send failed:', e.message));
      }
    }
    if (u.connection === 'close') {
      stopCron();
      stopTide();
      const reason = u.lastDisconnect?.error;
      const code = reason?.output?.statusCode ?? reason?.statusCode;
      const msg = reason?.message || reason?.output?.payload?.message;
      const why = DISCONNECT_REASONS[code] || (code != null ? `Code ${code}` : 'unknown');
      console.log('WhatsApp disconnected:', why);
      if (msg) console.log('  →', msg);
      if (code === 401 || code === 403 || code === 428) {
        console.log('  → Run: pnpm run auth   to re-link your device.');
      }
      if (typeof opts.onDisconnect === 'function') opts.onDisconnect(code);
    }
  });

  // Message flow: intercept incoming → immediate reply → schedule/LLM in background.
  let selfJid = sock.user?.id;
  sock.ev.on('creds.update', () => { selfJid = sock.user?.id; });
  const repliedIds = new Set();
  const lastSentByJid = new Map();
  const ourSentMessageIds = new Set(); // IDs of messages we sent (to ignore echo in self-chat)
  const pendingBioJids = new Set();
  const pendingBioConfirmJids = new Set();
  const bioPromptSentJids = new Set(); // only send setup prompt once per chat

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages ?? []) {
      if (!m.key?.remoteJid) continue;
      if (isJidBroadcast(m.key.remoteJid)) continue;

      selfJid = selfJid ?? sock.user?.id;
      const jid = m.key.remoteJid;

      // WhatsApp group: respond only when not from us; use group selective-reply (mention or gap/missing info).
      if (isWhatsAppGroupJid(jid)) {
        if (m.key.fromMe) continue;
        const content = extractMessageContent(m.message);
        let userText = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
        if (!userText && content?.imageMessage) {
          try {
            const buf = await downloadMediaMessage(m, 'buffer', {});
            const uploadsDir = getUploadsDir();
            if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
            const msgId = m.key?.id || Date.now();
            const imagePath = join(uploadsDir, `wa-group-${msgId}.jpg`);
            writeFileSync(imagePath, buf);
            const caption = (content.imageMessage.caption || '').trim();
            userText = `User sent an image. Image file: ${imagePath}. ${caption ? 'Caption: ' + caption : "What's in this image?"}`;
          } catch (err) {
            console.error('[image] group download failed:', err.message);
            continue;
          }
        }
        if (!userText) continue;
        if (userText.startsWith('[CowCode]')) continue;
        const msgKey = m.key.id ? `${jid}:${m.key.id}` : null;
        if (msgKey && repliedIds.has(msgKey)) continue;
        if (msgKey) {
          repliedIds.add(msgKey);
          if (repliedIds.size > MAX_REPLIED_IDS) {
            const first = repliedIds.values().next().value;
            if (first) repliedIds.delete(first);
          }
        }
        const participant = m.key.participant || '';
        const preferredName = participant ? getGroupDisplayName('whatsapp', participant) : null;
        const senderName = (preferredName && preferredName.trim()) || (m.pushName && String(m.pushName).trim()) || (participant ? participant.split('@')[0] || 'A group member' : 'A group member');
        const setMyName = parseSetDisplayNameMessage(userText);
        if (setMyName != null) {
          if (participant) setGroupDisplayName('whatsapp', participant, setMyName);
          const confirmText = `[CowCode] Got it, I'll call you ${setMyName} in the group.`;
          sock.sendMessage(jid, { text: confirmText }).catch(() => pendingReplies.push({ jid, text: confirmText }));
          continue;
        }
        const mentionedJids = content?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const groupMentioned = selfJid && Array.isArray(mentionedJids) && mentionedJids.some((id) => id && areJidsSameUser(id, selfJid));
        const textForAgent = `Message from ${senderName} in the group:\n\n${userText}`;
        const workspaceDir = getWorkspaceDir();
        const logExchange = (exchange) => {
          try {
            appendGroupExchange(workspaceDir, jid, exchange);
          } catch (err) {
            console.error('[group-chat-log] write failed:', err.message);
          }
        };
        console.log('[whatsapp-group]', String(jid), userText.slice(0, 50) + (userText.length > 50 ? '…' : ''));
        await runPastDueOneShots().catch((e) => console.error('[cron] runPastDueOneShots:', e.message));
        runAgentWithSkills(sock, jid, textForAgent, lastSentByJid, selfJid ?? sock.user?.id, { current: ourSentMessageIds }, {
          groupNonOwner: true,
          groupSenderName: senderName,
          groupJid: jid,
          groupMentioned: !!groupMentioned,
          logExchange,
        }).catch((err) => {
          console.error('WhatsApp group agent error:', err.message);
          const errorText = '[CowCode] Moo — ' + toUserMessage(err);
          sock.sendMessage(jid, { text: errorText }).catch(() => pendingReplies.push({ jid, text: errorText }));
        });
        continue;
      }

      // Only respond in self-chat (saved messages): from us and chat is with ourselves. Ignore all other chats.
      if (!m.key.fromMe) continue;
      if (!selfJid || !areJidsSameUser(jid, selfJid)) continue;

      const content = extractMessageContent(m.message);
      let userText = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
      let userSentVoice = false;
      if (!userText && content?.imageMessage) {
        try {
          const buf = await downloadMediaMessage(m, 'buffer', {});
          const uploadsDir = getUploadsDir();
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
          const msgId = m.key?.id || Date.now();
          const imagePath = join(uploadsDir, `image-${msgId}.jpg`);
          writeFileSync(imagePath, buf);
          const caption = (content.imageMessage.caption || '').trim();
          userText = `User sent an image. Image file: ${imagePath}. ${caption ? 'Caption: ' + caption : "What's in this image?"}`;
        } catch (err) {
          console.error('[image] download failed:', err.message);
          continue;
        }
      }
      if (!userText && content?.audioMessage) {
        try {
          const speechConfig = getSpeechConfig();
          if (speechConfig?.whisperApiKey) {
            const buf = await downloadMediaMessage(m, 'buffer', {});
            const uploadsDir = getUploadsDir();
            if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
            const msgId = m.key?.id || Date.now();
            const ext = (content.audioMessage.mimetype || '').includes('ogg') ? 'ogg' : 'm4a';
            const audioPath = join(uploadsDir, `voice-${msgId}.${ext}`);
            writeFileSync(audioPath, buf);
            userText = await transcribe(speechConfig.whisperApiKey, audioPath);
            if (userText && userText.trim()) userSentVoice = true;
          }
        } catch (err) {
          console.error('[voice] transcribe failed:', err.message);
        }
      }
      if (!userText) continue;

      // Do not treat our own CowCode replies as user input.
      if (userText.startsWith('[CowCode]')) continue;

      // Skip only when this is clearly our echo: fromMe and the text exactly matches what we last sent to this chat.
      const lastWeSent = lastSentByJid.get(jid);
      if (m.key.fromMe && typeof lastWeSent === 'string' && userText === lastWeSent) {
        console.log('[skip] our echo (fromMe, text matches last sent)');
        continue;
      }

      const msgKey = m.key.id ? `${jid}:${m.key.id}` : null;
      if (msgKey && repliedIds.has(msgKey)) {
        console.log('[skip] already replied to this message id');
        continue;
      }
      if (msgKey) {
        repliedIds.add(msgKey);
        if (repliedIds.size > MAX_REPLIED_IDS) {
          const first = repliedIds.values().next().value;
          if (first) repliedIds.delete(first);
        }
      }

      if (pendingBioConfirmJids.has(jid)) {
        pendingBioConfirmJids.delete(jid);
        if (isYesReply(userText)) {
          try {
            await sock.sendMessage(jid, { text: BIO_PROMPT });
            pendingBioJids.add(jid);
          } catch (e) {
            pendingReplies.push({ jid, text: BIO_PROMPT });
            pendingBioJids.add(jid);
          }
        } else {
          const noThanks = "No problem. You can do it later from setup.";
          try {
            await sock.sendMessage(jid, { text: noThanks });
          } catch (e) {
            pendingReplies.push({ jid, text: noThanks });
          }
        }
        continue;
      }

      if (pendingBioJids.has(jid)) {
        saveBioToConfig(userText);
        pendingBioJids.delete(jid);
        const thanks = "Thanks, I've saved that.";
        try {
          await sock.sendMessage(jid, { text: thanks });
        } catch (e) {
          pendingReplies.push({ jid, text: thanks });
        }
        continue;
      }

      if (userText.trim().toLowerCase() === '/browse-reset') {
        await resetBrowseSession({ jid });
        const reply = 'Browser reset. Next browse will start fresh.';
        try {
          await sock.sendMessage(jid, { text: reply });
        } catch (e) {
          pendingReplies.push({ jid, text: reply });
        }
        continue;
      }

      if (userSentVoice && userText) {
        userText += '\n\n[The user sent a voice message. Reply using the speech skill with action reply_as_voice so your reply is sent as a voice message.]';
      }

      console.log('[incoming]', userText.slice(0, 60) + (userText.length > 60 ? '…' : ''));
      try {
        await runPastDueOneShots().catch((e) => console.error('[cron] runPastDueOneShots:', e.message));
        if (m.key.id) {
          try {
            await sock.readMessages([{ remoteJid: jid, id: m.key.id, participant: m.key.participant, fromMe: false }]);
          } catch (_) {}
        }

        runAgentWithSkills(sock, jid, userText, lastSentByJid, selfJid ?? sock.user?.id, { current: ourSentMessageIds }, { pendingBioJids, pendingBioConfirmJids, bioPromptSentJids }).catch((err) => {
          console.error('Background agent error:', err.message);
          const errorText = '[CowCode] Moo — ' + toUserMessage(err);
          sock.sendMessage(jid, { text: errorText }).catch(() => {
            pendingReplies.push({ jid, text: errorText });
          });
        });
      } catch (err) {
        console.error('LLM error:', err.message);
        const errorText = '[CowCode] Moo — ' + toUserMessage(err);
        try {
          await sock.sendMessage(jid, { text: errorText });
        } catch (_) {
          pendingReplies.push({ jid, text: errorText });
        }
      }
    }
  });

  if (telegramSock && telegramBot) {
    const telegramRepliedIds = new Set();
    const MAX_TELEGRAM_REPLIED = 500;
    const telegramCtx = {
      bot: telegramBot,
      sock: telegramSock,
      getChannelsConfig,
      getSpeechConfig,
      getUploadsDir,
      transcribe,
      clearPendingTelegram,
      addPendingTelegram,
      getOwnerConfig,
      isOwner,
      pendingBioConfirmJids,
      pendingBioJids,
      bioPromptSentJids,
      saveBioToConfig,
      telegramRepliedIds,
      MAX_TELEGRAM_REPLIED,
      resetBrowseSession,
      runPastDueOneShots,
      runAgentWithSkills,
      lastSentByJid,
      ourSentMessageIds,
      getMemoryConfig,
      indexChatExchange,
      getWorkspaceDir,
      toUserMessage,
      getBotUsername: createGetBotUsername(telegramBot),
      getGroupAddedBy,
      getGroupPromptMessages: () => loadGroupMd(getWorkspaceDir(), DEFAULT_WORKSPACE_DIR).messages,
    };
    let cachedTelegramBotUserId = null;
    async function getTelegramBotUserId() {
      if (cachedTelegramBotUserId != null) return cachedTelegramBotUserId;
      try {
        const me = await telegramBot.getMe();
        cachedTelegramBotUserId = me?.id ?? null;
      } catch {
        cachedTelegramBotUserId = null;
      }
      return cachedTelegramBotUserId;
    }
    telegramBot.on('message', async (msg) => {
      if (isTelegramGroup(msg.chat)) {
        const chatId = msg.chat?.id;
        const newMembers = msg.new_chat_members;
        if (chatId != null && Array.isArray(newMembers) && newMembers.length > 0 && msg.from?.id != null) {
          const botUserId = await getTelegramBotUserId();
          if (botUserId != null && newMembers.some((u) => u?.id === botUserId || (u?.is_bot && String(u?.id) === String(botUserId)))) {
            setGroupAddedBy(chatId, msg.from.id);
          }
        }
        await handleTelegramGroupMessage(msg, telegramCtx);
      } else {
        await handleTelegramPrivateMessage(msg, telegramCtx);
      }
    });
  }
  }

  // Telegram-only or test: single run, no reconnect
  if (telegramOnlyMode || process.argv.includes('--test')) {
    runBot(sock, {});
    return;
  }

  // Need-auth path: single run after QR/pairing
  if (needAuth) {
    runBot(sock, {});
    return;
  }

  // Normal path: connect with retry and reconnect loop
  let reconnectAttempt = 0;
  while (true) {
    let s;
    try {
      s = await connectWhatsApp();
    } catch (e) {
      const code = e.code != null ? Number(e.code) : null;
      if (code !== null && NO_RETRY_CODES.has(code)) {
        console.log('Cannot reconnect (logged out or forbidden). Run: pnpm run auth');
        process.exit(1);
      }
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt++;
      console.log('Connection failed. Reconnecting in', Math.round(delay / 1000), 's...');
      await sleep(delay);
      continue;
    }
    reconnectAttempt = 0;
    const disconnectPromise = new Promise((resolve) => {
      runBot(s, { onDisconnect: (code) => resolve({ code }) });
    });
    const { code } = await disconnectPromise;
    if (code !== null && code !== undefined && NO_RETRY_CODES.has(code)) {
      console.log('Logged out or forbidden. Run: pnpm run auth');
      break;
    }
    const delay = RECONNECT_DELAYS_MS[0];
    console.log('Reconnecting in', Math.round(delay / 1000), 's...');
    await sleep(delay);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
