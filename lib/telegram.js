/**
 * Telegram bot: sock-like interface so the same agent/cron flow can send to Telegram.
 * Set TELEGRAM_BOT_TOKEN in env (or in ~/.cowcode/.env) to enable.
 */

import TelegramBot from 'node-telegram-bot-api';

let bot = null;

/**
 * @param {string} token - Bot token from @BotFather
 * @returns {TelegramBot}
 */
export function initBot(token) {
  if (!token || !String(token).trim()) return null;
  bot = new TelegramBot(token.trim(), { polling: true });
  bot.on('polling_error', (err) => {
    const msg = err?.message || String(err);
    if (msg.includes('409') || msg.includes('Conflict') || msg.includes('getUpdates')) {
      console.log('[Telegram] Another cowCode is already using this bot; this process won\'t get Telegram messages. To use this process instead, stop the other: cowcode moo stop');
      bot.stopPolling().catch(() => {});
    } else {
      console.log('[Telegram] Connection issue:', msg.slice(0, 80) + (msg.length > 80 ? '…' : ''));
    }
  });
  return bot;
}

export function getBot() {
  return bot;
}

/** Telegram chat IDs are numeric (user) or negative (groups). WhatsApp JIDs contain '@'. */
export function isTelegramChatId(jid) {
  if (jid == null) return false;
  const s = String(jid).trim();
  return /^-?\d+$/.test(s);
}

/** True if jid is a Telegram group/supergroup (negative chat id). Used to keep group log/memory separate from main. */
export function isTelegramGroupJid(jid) {
  if (jid == null) return false;
  const n = parseInt(String(jid).trim(), 10);
  return !Number.isNaN(n) && n < 0;
}

/** Telegram Bot API limit is 4096; use 4000 to leave a small buffer. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

/**
 * Split text into chunks each at most maxLen characters, breaking at newlines or spaces when possible.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function chunkTextForTelegram(text, maxLen = TELEGRAM_MAX_MESSAGE_LENGTH) {
  if (!text || text.length <= maxLen) return text ? [text] : [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf('\n');
    const lastSpace = slice.lastIndexOf(' ');
    const splitAt = lastNewline >= 0 ? lastNewline + 1 : (lastSpace >= 0 ? lastSpace + 1 : maxLen);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).replace(/^\s+/, '');
  }
  return chunks;
}

/**
 * Send text to a Telegram chat, splitting into multiple messages if over the API limit.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {string} text
 * @returns {Promise<{ key: { id: string } }>} Last sent message key for compatibility
 */
const MAX_PART_HEADER_LEN = 20; // e.g. "(Part 99/99)\n\n"

export async function sendLongText(bot, chatId, text) {
  const maxChunk = TELEGRAM_MAX_MESSAGE_LENGTH - MAX_PART_HEADER_LEN;
  const chunks = chunkTextForTelegram(text ?? '', maxChunk);
  if (chunks.length === 0) {
    const sent = await bot.sendMessage(chatId, '');
    return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
  }
  let lastSent = null;
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? `(Part ${i + 1}/${chunks.length})\n\n${chunks[i]}` : chunks[i];
    lastSent = await bot.sendMessage(chatId, part);
  }
  return { key: { id: lastSent?.message_id?.toString?.() ?? 'tg-' + Date.now() } };
}

/**
 * Sock-like object for runAgentWithSkills and sendMessage compatibility.
 * sendMessage(chatId, { text }) -> sends text, paginated if over Telegram limit
 * sendMessage(chatId, { voice: buffer }) -> bot.sendVoice(chatId, buffer) for voice replies
 */
export function createTelegramSock(telegramBot) {
  if (!telegramBot) return null;
  return {
    sendMessage: async (chatId, opts) => {
      if (opts?.voice && Buffer.isBuffer(opts.voice)) {
        const sent = await telegramBot.sendVoice(chatId, opts.voice, { filename: 'reply.ogg' });
        return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
      }
      const text = opts?.text ?? '';
      return sendLongText(telegramBot, chatId, text);
    },
    sendPresenceUpdate: () => {},
    user: { id: 'telegram' },
  };
}
