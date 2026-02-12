/**
 * WhatsApp + configurable LLM. On incoming message → LLM reply → send back.
 * No tools. Switch backends via config.json or env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).
 */

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
import { chat as llmChat, loadConfig } from './llm.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync } from 'fs';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, 'auth_info');

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
  console.log('LLM config:', { baseUrl: config.baseUrl, model: config.model });

  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') {
      console.log('WhatsApp connected. Self JID:', sock.user?.id ?? 'unknown');
    }
    if (u.connection === 'close') console.log('WhatsApp disconnected.');
  });

  // Message flow: intercept incoming → local LLM → reply once per message. No tools/schema.
  let selfJid = sock.user?.id;
  sock.ev.on('creds.update', () => { selfJid = sock.user?.id; });
  const repliedIds = new Set();
  const lastSentByJid = new Map();
  const MAX_REPLIED_IDS = 500;

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages ?? []) {
      if (!m.key?.remoteJid) continue;
      if (isJidBroadcast(m.key.remoteJid)) continue;

      selfJid = selfJid ?? sock.user?.id;
      const isSelfChat = selfJid && areJidsSameUser(m.key.remoteJid, selfJid);
      if (m.key.fromMe && !isSelfChat) continue;

      const content = extractMessageContent(m.message);
      const text = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
      if (!text) continue;

      const jid = m.key.remoteJid;
      if (m.key.fromMe && isSelfChat && text === lastSentByJid.get(jid)) continue;

      const msgKey = m.key.id ? `${jid}:${m.key.id}` : null;
      if (msgKey && repliedIds.has(msgKey)) continue;
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
        try {
          await sock.sendPresenceUpdate('composing', jid);
        } catch (_) {}
        const rawReply = await llmChat([
          { role: 'system', content: 'You are a helpful assistant. Reply concisely in the same language the user uses. Do not use <think> or any thinking/reasoning blocks in your response—output only your final reply, nothing else.' },
          { role: 'user', content: text },
        ]);
        const reply = stripThinking(rawReply);
        if (reply) {
          const textToSend = '[CowCode] ' + reply;
          await sock.sendMessage(jid, { text: textToSend });
          lastSentByJid.set(jid, textToSend);
          console.log('[replied]');
        }
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
    .replace(/<\/think>/gi, '')
    .trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
