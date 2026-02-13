/**
 * WhatsApp + configurable LLM. On incoming message → LLM reply → send back.
 * Config values come from .env (see .env.example). No secrets in config.json.
 */

import 'dotenv/config';
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
} = Baileys;
import { chat as llmChat, chatWithTools, classifyIntent, loadConfig } from './llm.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync } from 'fs';
import pino from 'pino';
import { startCron, stopCron, scheduleOneShot } from './cron/runner.js';
import { getEnabledTools, executeSkill } from './skills/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, 'auth_info');
const CRON_STORE_PATH = join(__dirname, 'cron', 'jobs.json');

if (typeof makeWASocket !== 'function') {
  throw new Error('Baileys makeWASocket not found. Check @whiskeysockets/baileys version.');
}

const authOnly = process.argv.includes('--auth-only');
const pairIndex = process.argv.indexOf('--pair');
const pairNumber = pairIndex !== -1 ? process.argv[pairIndex + 1] : null;

// In auth mode show connection errors so we can see why linking fails
const logger = pino({ level: authOnly ? 'error' : 'silent' });

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

async function runAuthOnly() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    printQRInTerminal: true,
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', async (u) => {
      if (u.connection) {
        console.log('[connection]', u.connection);
        if (u.connection === 'open') {
          console.log('Linked. You can Ctrl+C and run pnpm start.');
          resolve(sock);
          return;
        }
        if (u.connection === 'close' && u.lastDisconnect) {
          const err = u.lastDisconnect.error;
          const code = err?.output?.statusCode ?? err?.statusCode;
          const msg = err?.message || err?.output?.payload?.message;
          const reason = DISCONNECT_REASONS[code] || `Code ${code}`;
          console.error('[disconnect]', reason);
          if (msg) console.error('[disconnect message]', msg);
          if (code === RESTART_REQUIRED_CODE) {
            console.log('Reconnecting so the link can finish…');
            try { sock.end(undefined); } catch (_) {}
            resolve('restart');
            return;
          }
          reject(new Error(reason));
          return;
        }
      }
      if (u.qr) {
        console.log('QR above ↑ — Scan with WhatsApp (Linked devices).');
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

async function main() {
  if (authOnly && existsSync(AUTH_DIR)) {
    rmSync(AUTH_DIR, { recursive: true });
    mkdirSync(AUTH_DIR, { recursive: true });
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

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    printQRInTerminal: false,
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  const config = loadConfig();
  const first = config.models[0];
  console.log('LLM config:', config.models.length > 1
    ? `${config.models.length} models (priority): ${config.models.map(m => m.model).join(' → ')}`
    : { baseUrl: first.baseUrl, model: first.model });
  const { getSkillsConfig } = await import('./skills/registry.js');
  const skillsConfig = getSkillsConfig();
  console.log('Skills enabled:', skillsConfig.enabled?.length ? skillsConfig.enabled.join(', ') : 'cron (default)');

  const MAX_REPLIED_IDS = 500;
  const MAX_OUR_SENT_IDS = 200;

  // Agent logic (shared by real socket handler and --test mode)
  const allTools = getEnabledTools();
  function getToolsForIntent(intent) {
    if (intent === 'SCHEDULE_LIST' || intent === 'SCHEDULE_CREATE') {
      return allTools.filter((t) => t.function?.name === 'cron');
    }
    if (intent === 'SEARCH') {
      return allTools.filter((t) => t.function?.name === 'browser');
    }
    return [];
  }
  const chatSystemPrompt = 'You are a helpful assistant. Reply concisely in the same language the user uses. Do not use <think> or any thinking/reasoning blocks—output only your final reply.';
  function getBrowserSystemPrompt() {
    return `You are a helpful assistant with access to the browser tool to search the web or open a URL. Reply concisely in the same language the user uses. Do not use <think> or any thinking/reasoning blocks—output only your final reply.

Use the browser tool to get current information: call action "search" with "query" set to the user's search (e.g. recent trends, latest news). Then answer based on the returned content. If the user gave a specific URL, use action "navigate" with "url". Summarize the results clearly for the user.`;
  }
  function getScheduleSystemPrompt() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const in1min = new Date(now + 60_000).toISOString();
    const in2min = new Date(now + 120_000).toISOString();
    const in3min = new Date(now + 180_000).toISOString();
    return `You are a helpful assistant with access to the cron tool for reminders. Reply concisely in the same language the user uses. Do not use <think> or any thinking/reasoning blocks—output only your final reply.

CRITICAL - Choose the right action:
- If the user only asks to LIST, SEE, COUNT, or ask WHAT/WHICH crons exist (e.g. "how many crons?", "what is the next cron?", "which crons are set?", "list my reminders", "what's scheduled?") → call the cron tool exactly ONCE with action "list". Do NOT call "add" in the same message.
- "Which crons are set?" means list existing crons, NOT create new ones. Use list only.
- Use "add" only when the user explicitly asks to CREATE or SET a new reminder (e.g. "remind me in 5 minutes", "send me X tomorrow").
- Use "remove" when the user asks to cancel/delete a specific job (by id).

Use the cron tool to add, list, or remove reminders as requested. For multiple reminders in one message, call the cron tool once per reminder. Each call must have a different schedule.at time.

Current time: ${nowIso}. Use future ISO 8601 for "at". Examples: "in 1 minute" = ${in1min}; "in 2 minutes" = ${in2min}; "in 3 minutes" = ${in3min}. For "every one minute for the next three minutes" you MUST call cron add THREE times: first at ${in1min}, second at ${in2min}, third at ${in3min}. Never use the same "at" for multiple jobs.

Important: job.message must be exactly what the user asked to receive (e.g. "fun fact" / "Give me a fun fact"—do not substitute "Hello, how can I assist").`;
  }
  async function runAgentWithSkills(sock, jid, text, lastSentByJidMap, selfJidForCron, ourSentIdsRef) {
    console.log('[agent] runAgentWithSkills started for:', text.slice(0, 60));
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (_) {}
    let intent = 'CHAT';
    try {
      intent = await classifyIntent(text);
      console.log('[agent] intent:', intent);
    } catch (err) {
      console.error('[agent] intent classification failed:', err.message);
    }
    const toolsToUse = getToolsForIntent(intent);
    const useTools = toolsToUse.length > 0;
    const isListOnly = intent === 'SCHEDULE_LIST';
    const isSearch = intent === 'SEARCH';
    if (useTools && !isListOnly && !isSearch) {
      const immediateReply = "[CowCode] Got it, one moment.";
      const immediateSent = await sock.sendMessage(jid, { text: immediateReply });
      if (immediateSent?.key?.id && ourSentIdsRef?.current) {
        ourSentIdsRef.current.add(immediateSent.key.id);
        if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
          const first = ourSentIdsRef.current.values().next().value;
          if (first) ourSentIdsRef.current.delete(first);
        }
      }
      lastSentByJidMap.set(jid, immediateReply);
      console.log('[replied] (immediate)');
    }
    const systemPrompt = useTools
      ? (intent === 'SEARCH' ? getBrowserSystemPrompt() : getScheduleSystemPrompt())
      : chatSystemPrompt;
    const ctx = {
      storePath: CRON_STORE_PATH,
      jid,
      scheduleOneShot,
      startCron: () => startCron({ sock, selfJid: selfJidForCron, storePath: CRON_STORE_PATH }),
    };
    let messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ];
    let finalContent = '';
    let cronListResult = null;
    let browserResult = null;
    const maxToolRounds = 1;
    for (let round = 0; round <= maxToolRounds; round++) {
      if (!useTools) {
        const rawReply = await llmChat(messages);
        finalContent = stripThinking(rawReply);
        break;
      }
      const { content, toolCalls } = await chatWithTools(messages, toolsToUse);
      if (!toolCalls || toolCalls.length === 0) {
        finalContent = content || '';
        break;
      }
      const assistantMsg = {
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages = messages.concat(assistantMsg);
      for (const tc of toolCalls) {
        let args = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          args = {};
        }
        const skillId = tc.name;
        const action = args?.action && String(args.action).trim().toLowerCase();
        const isSpuriousAdd = useTools && isListOnly && skillId === 'cron' && action === 'add';
        if (isSpuriousAdd) {
          console.log('[agent] tool call:', skillId, '(add skipped: list-only query)');
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: 'Skipped: user only asked to list existing crons; no job added.',
          });
          continue;
        }
        console.log('[agent] tool call:', skillId, tc.arguments?.slice(0, 80));
        const result = await executeSkill(skillId, ctx, args);
        if (skillId === 'cron' && action === 'list' && result && typeof result === 'string') {
          cronListResult = result;
        }
        if (skillId === 'browser' && result && typeof result === 'string') {
          browserResult = result;
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }
    }
    let textToSend;
    if (finalContent && stripThinking(finalContent).trim()) {
      textToSend = '[CowCode] ' + stripThinking(finalContent).trim();
    } else if (cronListResult && cronListResult.trim()) {
      textToSend = '[CowCode] ' + cronListResult.trim();
    } else if (browserResult && browserResult.trim()) {
      let browserReply = browserResult.trim();
      try {
        const parsed = JSON.parse(browserReply);
        if (parsed && typeof parsed.error === 'string') {
          const err = parsed.error;
          if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
            browserReply = "I couldn't run the search because the browser isn't set up. Run: pnpm exec playwright install";
          } else {
            browserReply = 'Search failed: ' + err;
          }
        }
      } catch (_) {
        browserReply = browserReply.slice(0, 2000) + (browserReply.length > 2000 ? '…' : '');
      }
      textToSend = '[CowCode] ' + browserReply;
    } else {
      textToSend = "[CowCode] Done. Anything else?";
    }
    const sent = await sock.sendMessage(jid, { text: textToSend });
    if (sent?.key?.id && ourSentIdsRef?.current) {
      ourSentIdsRef.current.add(sent.key.id);
      if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
        const first = ourSentIdsRef.current.values().next().value;
        if (first) ourSentIdsRef.current.delete(first);
      }
    }
    lastSentByJidMap.set(jid, textToSend);
    console.log('[replied]', useTools ? '(agent + skills)' : '(chat)');
  }

  // --test: run main code path once with a fake socket, write to real cron/jobs.json then exit
  if (process.argv.includes('--test')) {
    const testIdx = process.argv.indexOf('--test');
    const testMsg = process.argv[testIdx + 1] || process.env.TEST_MESSAGE || 'Send me hello in 1 minute';
    const mockSock = {
      sendMessage: async () => ({ key: { id: 'test-' + Date.now() } }),
      sendPresenceUpdate: async () => {},
      readMessages: async () => {},
    };
    const lastSent = new Map();
    const sentIds = { current: new Set() };
    console.log('[test] Running main code path with message:', testMsg.slice(0, 60));
    await runAgentWithSkills(mockSock, 'test@s.whatsapp.net', testMsg, lastSent, 'test@s.whatsapp.net', sentIds);
    console.log('[test] Done. Check cron/jobs.json.');
    process.exit(0);
  }

  console.log('Connecting to WhatsApp…');
  sock.ev.on('connection.update', (u) => {
    if (u.connection != null) {
      console.log('[connection]', u.connection);
    }
    if (u.connection === 'open') {
      const sid = sock.user?.id ?? selfJid;
      if (sid) selfJid = sid;
      console.log('WhatsApp connected. Self JID:', sid ?? 'unknown');
      if (sid) {
        startCron({ sock, selfJid: sid, storePath: join(__dirname, 'cron', 'jobs.json') });
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
    }
  });

  // Message flow: intercept incoming → immediate reply → schedule/LLM in background.
  let selfJid = sock.user?.id;
  sock.ev.on('creds.update', () => { selfJid = sock.user?.id; });
  const repliedIds = new Set();
  const lastSentByJid = new Map();
  const ourSentMessageIds = new Set(); // IDs of messages we sent (to ignore echo in self-chat)

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
      const text = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
      if (!text) continue;

      // Do not treat our own CowCode replies as user input.
      if (text.startsWith('[CowCode]')) continue;

      // Skip only when this is clearly our echo: fromMe and the text exactly matches what we last sent to this chat.
      const lastWeSent = lastSentByJid.get(jid);
      if (m.key.fromMe && typeof lastWeSent === 'string' && text === lastWeSent) {
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

      console.log('[incoming]', text.slice(0, 60) + (text.length > 60 ? '…' : ''));
      try {
        if (m.key.id) {
          try {
            await sock.readMessages([{ remoteJid: jid, id: m.key.id, participant: m.key.participant, fromMe: false }]);
          } catch (_) {}
        }

        runAgentWithSkills(sock, jid, text, lastSentByJid, selfJid ?? sock.user?.id, { current: ourSentMessageIds }).catch((err) => {
          console.error('Background agent error:', err.message);
          sock.sendMessage(jid, { text: `[CowCode] Error: ${err.message}` }).catch(() => {});
        });
      } catch (err) {
        console.error('LLM error:', err.message);
        await sock.sendMessage(jid, { text: `[CowCode] Error: ${err.message}` });
      }
    }
  });
}

function stripThinking(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
