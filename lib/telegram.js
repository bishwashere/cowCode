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

/**
 * Sock-like object for runAgentWithSkills and sendMessage compatibility.
 * sendMessage(chatId, { text }) -> bot.sendMessage(chatId, text)
 */
export function createTelegramSock(telegramBot) {
  if (!telegramBot) return null;
  return {
    sendMessage: async (chatId, opts) => {
      const text = opts?.text ?? '';
      const sent = await telegramBot.sendMessage(chatId, text);
      return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
    },
    sendPresenceUpdate: () => {},
    user: { id: 'telegram' },
  };
}
