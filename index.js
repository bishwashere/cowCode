/**
 * WhatsApp + configurable LLM. On incoming message → LLM reply → send back.
 * Config and state live in ~/.cowcode (or COWCODE_STATE_DIR).
 */

import { getAuthDir, getCronStorePath, getConfigPath, getEnvPath, ensureStateDir, getWorkspaceDir, getUploadsDir, getStateDir } from './lib/paths.js';
import dotenv from 'dotenv';

dotenv.config({ path: getEnvPath() });

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
import { runAgentTurn, stripThinking, CLARIFICATION_RULE } from './lib/agent.js';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import pino from 'pino';
import { startCron, stopCron, scheduleOneShot, runPastDueOneShots } from './cron/runner.js';
import { getSkillsEnabled, getSkillContext, DEFAULT_ENABLED } from './skills/loader.js';
import { initBot, createTelegramSock, isTelegramChatId } from './lib/telegram.js';
import { addPending as addPendingTelegram, flushPending as flushPendingTelegram } from './lib/pending-telegram.js';
import { getChannelsConfig } from './lib/channels-config.js';
import { getSchedulingTimeContext } from './lib/timezone.js';
import { getMemoryConfig } from './lib/memory-config.js';
import { indexChatExchange } from './lib/memory-index.js';
import { resetBrowseSession } from './lib/executors/browse.js';
import { toUserMessage } from './lib/user-error.js';
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

/** Migration: ensure all default skills (cron, search, browse, vision, memory) are in skills.enabled so new installs and updates get them without fresh install. */
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

  const config = loadConfig();
  const first = config.models[0];
  console.log('LLM config:', config.models.length > 1
    ? `${config.models.length} models (priority): ${config.models.map(m => m.model).join(' → ')}`
    : { baseUrl: first.baseUrl, model: first.model });
  const skillsEnabled = getSkillsEnabled();
  const { skillDocs, runSkillTool } = getSkillContext();
  console.log('Skills enabled:', skillsEnabled?.length ? skillsEnabled.join(', ') : 'cron (default)');

  const MAX_REPLIED_IDS = 500;
  const MAX_OUR_SENT_IDS = 200;
  const MAX_CHAT_HISTORY_EXCHANGES = 5;

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

  // Agent logic: LLM decides from skill docs; we only run what it returns (run_skill). No intent layer.
  const allTools = runSkillTool;
  const useSkills = Array.isArray(skillsEnabled) && skillsEnabled.length > 0 && allTools.length > 0;
  const toolsToUse = useSkills ? allTools : [];
  const useTools = toolsToUse.length > 0;

  const skillDocsBlock = skillDocs
    ? `\n\n# Available skills (read these to decide when to use run_skill and which arguments to pass)\n\n${skillDocs}\n\n# Clarification\n${CLARIFICATION_RULE}`
    : '';

  const WHO_AM_I_MD = 'WhoAmI.md';
  const MY_HUMAN_MD = 'MyHuman.md';
  const SOUL_MD = 'SOUL.md';

  const WORKSPACE_DEFAULT_FILES = [WHO_AM_I_MD, MY_HUMAN_MD, SOUL_MD];
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

  const DEFAULT_SOUL_CONTENT = `You are CowCode. A helpful assistant.
Answer in the language the user asked in.
Do not fabricate tool results or data that was not retrieved.
You may compute and answer using available results.
Do not use <think> or any reasoning blocks—output only the final reply.
Do not use asterisks in replies.
`;

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

  function buildSystemPrompt() {
    ensureSoulMd();
    const timeCtx = getSchedulingTimeContext();
    const timeBlock = `\n\n${timeCtx.timeContextLine}\nCurrent time UTC (for scheduling "at"): ${timeCtx.nowIso}. Examples: "in 1 minute" = ${timeCtx.in1min}; "in 2 minutes" = ${timeCtx.in2min}; "in 3 minutes" = ${timeCtx.in3min}.`;
    const pathsLine = `\n\nCowCode on this system: state dir ${getStateDir()}, workspace ${getWorkspaceDir()}. When the user asks where cowcode is installed or where config is, use the read skill with path \`~/.cowcode/config.json\` (or the state dir path above) to show config and confirm.`;
    const soulContent = (readWorkspaceMd(SOUL_MD) || DEFAULT_SOUL_CONTENT) + pathsLine;
    let whoAmIContent = readWorkspaceMd(WHO_AM_I_MD);
    const myHumanContent = readWorkspaceMd(MY_HUMAN_MD);
    if (!whoAmIContent && !myHumanContent) {
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
    } else {
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
    return useTools
      ? base + timeBlock + skillDocsBlock
      : base + `\n\n${timeCtx.timeContextLine}`;
  }

  async function runAgentWithSkills(sock, jid, text, lastSentByJidMap, selfJidForCron, ourSentIdsRef, bioOpts = {}) {
    console.log('[agent] handling:', text.slice(0, 50) + (text.length > 50 ? '…' : ''));
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (_) {}
    const ctx = {
      storePath: getCronStorePath(),
      jid,
      workspaceDir: getWorkspaceDir(),
      scheduleOneShot,
      startCron: () => startCron({ sock, selfJid: selfJidForCron, storePath: getCronStorePath(), telegramBot: telegramBot || undefined }),
    };
    const { textToSend } = await runAgentTurn({
      userText: text,
      ctx,
      systemPrompt: buildSystemPrompt(),
      tools: toolsToUse,
      historyMessages: getLast5Exchanges(jid),
    });
    const textForSend = isTelegramChatId(jid) ? textToSend.replace(/^\[CowCode\]\s*/i, '').trim() : textToSend;
    try {
      const sent = await sock.sendMessage(jid, { text: textForSend });
      if (sent?.key?.id && ourSentIdsRef?.current) {
        ourSentIdsRef.current.add(sent.key.id);
        if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
          const first = ourSentIdsRef.current.values().next().value;
          if (first) ourSentIdsRef.current.delete(first);
        }
      }
      lastSentByJidMap.set(jid, textForSend);
      pushExchange(jid, text, textForSend);
      const memoryConfig = getMemoryConfig();
      if (memoryConfig) {
        indexChatExchange(memoryConfig, { user: text, assistant: textForSend, timestampMs: Date.now(), jid }).catch((err) =>
          console.error('[memory] auto-index failed:', err.message)
        );
      }
      console.log('[replied]', useTools ? '(agent + skills)' : '(chat)');
      if (bioOpts.pendingBioConfirmJids != null && !isBioSet()) {
        try {
          await sock.sendMessage(jid, { text: BIO_CONFIRM_PROMPT });
          bioOpts.pendingBioConfirmJids.add(jid);
        } catch (_) {
          if (isTelegramChatId(jid)) addPendingTelegram(jid, BIO_CONFIRM_PROMPT);
          else pendingReplies.push({ jid, text: BIO_CONFIRM_PROMPT });
          bioOpts.pendingBioConfirmJids.add(jid);
        }
      }
    } catch (sendErr) {
      lastSentByJidMap.set(jid, textForSend); // E2E can still assert on intended reply when send fails
      if (!isTelegramChatId(jid)) {
        pendingReplies.push({ jid, text: textForSend });
        console.log('[replied] queued (send failed, will retry after reconnect):', sendErr.message);
      } else {
        addPendingTelegram(jid, textForSend);
        console.log('[replied] Telegram queued (send failed, will retry on next message):', sendErr.message);
      }
    }
  }

  // --test: run main code path once with mock socket (set above), then exit. No WhatsApp auth.
  // E2E tests capture stdout and parse E2E_REPLY_START...E2E_REPLY_END to assert on the reply.
  if (process.argv.includes('--test')) {
    const testIdx = process.argv.indexOf('--test');
    const testMsg = process.argv[testIdx + 1] || process.env.TEST_MESSAGE || 'Send me hello in 1 minute';
    const lastSent = new Map();
    const sentIds = { current: new Set() };
    console.log('[test] Running main code path with message:', testMsg.slice(0, 60));
    try {
      await runAgentWithSkills(sock, 'test@s.whatsapp.net', testMsg, lastSent, 'test@s.whatsapp.net', sentIds);
    } catch (err) {
      lastSent.set('test@s.whatsapp.net', 'Moo — ' + (err && err.message ? err.message : String(err)));
    }
    const reply = lastSent.get('test@s.whatsapp.net');
    if (reply != null) {
      console.log('E2E_REPLY_START');
      console.log(reply);
      console.log('E2E_REPLY_END');
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
      const lastSentByJid = new Map();
      const ourSentMessageIds = new Set();
      const telegramRepliedIds = new Set();
      const pendingBioJids = new Set();
      const pendingBioConfirmJids = new Set();
      const MAX_TELEGRAM_REPLIED = 500;
      optsTelegramBot.on('message', async (msg) => {
        const chatId = msg.chat?.id;
        let text = (msg.text || '').trim();
        if (chatId == null) return;
        if (!text && msg.photo && msg.photo.length > 0) {
          try {
            const photo = msg.photo[msg.photo.length - 1];
            const file = await optsTelegramBot.getFile(photo.file_id);
            const token = getChannelsConfig().telegram.botToken;
            const downloadUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            const res = await fetch(downloadUrl);
            const buf = Buffer.from(await res.arrayBuffer());
            const uploadsDir = getUploadsDir();
            if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
            const imagePath = join(uploadsDir, `tg-${chatId}-${msg.message_id}.jpg`);
            writeFileSync(imagePath, buf);
            const caption = (msg.caption || '').trim();
            text = `User sent an image. Image file: ${imagePath}. ${caption ? 'Caption: ' + caption : "What's in this image?"}`;
          } catch (err) {
            console.error('[telegram] image download failed:', err.message);
            return;
          }
        }
        if (!text) return;
        if (msg.from?.is_bot) return;
        if (text.startsWith('[CowCode]')) return;
        await flushPendingTelegram(chatId, optsTelegramBot);
        const jidKey = String(chatId);
        if (pendingBioConfirmJids.has(jidKey)) {
          pendingBioConfirmJids.delete(jidKey);
          if (isYesReply(text)) {
            await optsTelegramBot.sendMessage(chatId, BIO_PROMPT).catch(() => addPendingTelegram(jidKey, BIO_PROMPT));
            pendingBioJids.add(jidKey);
          } else {
            await optsTelegramBot.sendMessage(chatId, "No problem. You can do it later from setup.").catch(() => addPendingTelegram(jidKey, "No problem. You can do it later from setup."));
          }
          return;
        }
        if (pendingBioJids.has(jidKey)) {
          saveBioToConfig(text);
          pendingBioJids.delete(jidKey);
          await optsTelegramBot.sendMessage(chatId, "Thanks, I've saved that.").catch(() => addPendingTelegram(jidKey, "Thanks, I've saved that."));
          return;
        }
        const msgKey = `tg:${chatId}:${msg.message_id}`;
        if (telegramRepliedIds.has(msgKey)) return;
        telegramRepliedIds.add(msgKey);
        if (telegramRepliedIds.size > MAX_TELEGRAM_REPLIED) {
          const first = telegramRepliedIds.values().next().value;
          if (first) telegramRepliedIds.delete(first);
        }
        if (text.trim().toLowerCase() === '/browse-reset') {
          await resetBrowseSession({ jid: jidKey });
          const reply = 'Browser reset. Next browse will start fresh.';
          await optsTelegramBot.sendMessage(chatId, reply).catch(() => addPendingTelegram(String(chatId), reply));
          return;
        }
        console.log('[telegram]', String(chatId), text.slice(0, 60) + (text.length > 60 ? '…' : ''));
        await runPastDueOneShots().catch((e) => console.error('[cron] runPastDueOneShots:', e.message));
        runAgentWithSkills(sock, jidKey, text, lastSentByJid, jidKey, { current: ourSentMessageIds }, { pendingBioJids, pendingBioConfirmJids }).catch((err) => {
          console.error('Telegram agent error:', err.message);
          const errorText = 'Moo — ' + toUserMessage(err);
          optsTelegramBot.sendMessage(chatId, errorText).catch(() => addPendingTelegram(String(chatId), errorText));
        });
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
      }
      // Flush replies that failed to send while disconnected
      while (pendingReplies.length > 0) {
        const { jid, text } = pendingReplies.shift();
        sock.sendMessage(jid, { text }).catch((e) => console.error('[pending] send failed:', e.message));
      }
    }
    if (u.connection === 'close') {
      stopCron();
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

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages ?? []) {
      if (!m.key?.remoteJid) continue;
      if (isJidBroadcast(m.key.remoteJid)) continue;

      selfJid = selfJid ?? sock.user?.id;
      const jid = m.key.remoteJid;

      // Only respond in self-chat (saved messages): from us and chat is with ourselves. Ignore all other chats.
      if (!m.key.fromMe) continue;
      if (!selfJid || !areJidsSameUser(jid, selfJid)) continue;

      const content = extractMessageContent(m.message);
      let userText = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
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

      console.log('[incoming]', userText.slice(0, 60) + (userText.length > 60 ? '…' : ''));
      try {
        await runPastDueOneShots().catch((e) => console.error('[cron] runPastDueOneShots:', e.message));
        if (m.key.id) {
          try {
            await sock.readMessages([{ remoteJid: jid, id: m.key.id, participant: m.key.participant, fromMe: false }]);
          } catch (_) {}
        }

        runAgentWithSkills(sock, jid, userText, lastSentByJid, selfJid ?? sock.user?.id, { current: ourSentMessageIds }, { pendingBioJids, pendingBioConfirmJids }).catch((err) => {
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
    telegramBot.on('message', async (msg) => {
      const chatId = msg.chat?.id;
      let text = (msg.text || '').trim();
      if (chatId == null) return;
      if (!text && msg.photo && msg.photo.length > 0) {
        try {
          const photo = msg.photo[msg.photo.length - 1];
          const file = await telegramBot.getFile(photo.file_id);
          const token = getChannelsConfig().telegram.botToken;
          const downloadUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
          const res = await fetch(downloadUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          const uploadsDir = getUploadsDir();
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
          const imagePath = join(uploadsDir, `tg-${chatId}-${msg.message_id}.jpg`);
          writeFileSync(imagePath, buf);
          const caption = (msg.caption || '').trim();
          text = `User sent an image. Image file: ${imagePath}. ${caption ? 'Caption: ' + caption : "What's in this image?"}`;
        } catch (err) {
          console.error('[telegram] image download failed:', err.message);
          return;
        }
      }
      if (!text) return;
      if (msg.from?.is_bot) return;
      if (text.startsWith('[CowCode]')) return;
      await flushPendingTelegram(chatId, telegramBot);
      const jidKey = String(chatId);
      if (pendingBioConfirmJids.has(jidKey)) {
        pendingBioConfirmJids.delete(jidKey);
        if (isYesReply(text)) {
          await telegramBot.sendMessage(chatId, BIO_PROMPT).catch(() => addPendingTelegram(jidKey, BIO_PROMPT));
          pendingBioJids.add(jidKey);
        } else {
          await telegramBot.sendMessage(chatId, "No problem. You can do it later from setup.").catch(() => addPendingTelegram(jidKey, "No problem. You can do it later from setup."));
        }
        return;
      }
      if (pendingBioJids.has(jidKey)) {
        saveBioToConfig(text);
        pendingBioJids.delete(jidKey);
        await telegramBot.sendMessage(chatId, "Thanks, I've saved that.").catch(() => addPendingTelegram(jidKey, "Thanks, I've saved that."));
        return;
      }
      const msgKey = `tg:${chatId}:${msg.message_id}`;
      if (telegramRepliedIds.has(msgKey)) return;
      telegramRepliedIds.add(msgKey);
      if (telegramRepliedIds.size > MAX_TELEGRAM_REPLIED) {
        const first = telegramRepliedIds.values().next().value;
        if (first) telegramRepliedIds.delete(first);
      }
      if (text.trim().toLowerCase() === '/browse-reset') {
        await resetBrowseSession({ jid: jidKey });
        const reply = 'Browser reset. Next browse will start fresh.';
        await telegramBot.sendMessage(chatId, reply).catch(() => addPendingTelegram(String(chatId), reply));
        return;
      }
      console.log('[telegram]', String(chatId), text.slice(0, 60) + (text.length > 60 ? '…' : ''));
      await runPastDueOneShots().catch((e) => console.error('[cron] runPastDueOneShots:', e.message));
      runAgentWithSkills(telegramSock, jidKey, text, lastSentByJid, jidKey, { current: ourSentMessageIds }, { pendingBioJids, pendingBioConfirmJids }).catch((err) => {
        console.error('Telegram agent error:', err.message);
        const errorText = 'Moo — ' + toUserMessage(err);
        telegramBot.sendMessage(chatId, errorText).catch(() => addPendingTelegram(String(chatId), errorText));
      });
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
