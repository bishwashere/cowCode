/**
 * Chat log: append each user/assistant exchange to workspace/chat-log/YYYY-MM-DD.jsonl.
 * Used so memory search can pull from conversation history ("Remember what we said yesterday?").
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const CHAT_LOG_DIR = 'chat-log';

/**
 * @param {string} workspaceDir
 * @returns {string} Absolute path to chat-log dir
 */
function getChatLogDir(workspaceDir) {
  return join(workspaceDir, CHAT_LOG_DIR);
}

/**
 * Append one exchange to chat-log/YYYY-MM-DD.jsonl. Creates dir/file if needed.
 * @param {string} workspaceDir
 * @param {{ user: string, assistant: string, timestampMs: number, jid?: string }} exchange
 * @returns {{ path: string, lineNumber: number }} Relative path (e.g. chat-log/2025-02-16.jsonl) and 1-based line number of this exchange
 */
export function appendExchange(workspaceDir, exchange) {
  if (!workspaceDir || typeof workspaceDir !== 'string') {
    throw new Error('workspaceDir is required');
  }
  const { user, assistant, timestampMs, jid } = exchange;
  const date = new Date(timestampMs);
  const dateStr =
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0');
  const dir = getChatLogDir(workspaceDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, dateStr + '.jsonl');
  const line = JSON.stringify({
    ts: timestampMs,
    jid: jid ?? null,
    user: String(user ?? '').trim(),
    assistant: String(assistant ?? '').trim(),
  }) + '\n';
  appendFileSync(filePath, line, 'utf8');
  const content = readFileSync(filePath, 'utf8');
  const lineNumber = content.split('\n').filter((l) => l.trim()).length;
  const relPath = CHAT_LOG_DIR + '/' + dateStr + '.jsonl';
  return { path: relPath, lineNumber };
}

const GROUP_CHAT_LOG_DIR = 'group-chat-log';

/**
 * Append one exchange to group-chat-log/<groupJid>/YYYY-MM-DD.jsonl.
 * Used only for Telegram groups so main chat-log and main memory are never polluted by group traffic.
 * @param {string} workspaceDir
 * @param {string} groupJid - Telegram group chat id (negative number string)
 * @param {{ user: string, assistant: string, timestampMs: number }} exchange
 * @returns {{ path: string, lineNumber: number }} Relative path (e.g. group-chat-log/-12345/2025-02-16.jsonl)
 */
export function appendGroupExchange(workspaceDir, groupJid, exchange) {
  if (!workspaceDir || typeof workspaceDir !== 'string') {
    throw new Error('workspaceDir is required');
  }
  const safeId = String(groupJid).trim().replace(/[^0-9-]/g, '_') || 'group';
  const { user, assistant, timestampMs } = exchange;
  const date = new Date(timestampMs);
  const dateStr =
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0');
  const dir = join(workspaceDir, GROUP_CHAT_LOG_DIR, safeId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, dateStr + '.jsonl');
  const line = JSON.stringify({
    ts: timestampMs,
    user: String(user ?? '').trim(),
    assistant: String(assistant ?? '').trim(),
  }) + '\n';
  appendFileSync(filePath, line, 'utf8');
  const content = readFileSync(filePath, 'utf8');
  const lineNumber = content.split('\n').filter((l) => l.trim()).length;
  const relPath = GROUP_CHAT_LOG_DIR + '/' + safeId + '/' + dateStr + '.jsonl';
  return { path: relPath, lineNumber };
}

/**
 * Read the last N exchanges from group-chat-log for a Telegram group.
 * Used so the bot has recent group context (e.g. other people's questions) when replying in group chat.
 * @param {string} workspaceDir
 * @param {string} groupJid - Telegram group chat id (e.g. "-12345")
 * @param {number} maxExchanges - Max number of user+assistant pairs to return (e.g. 5)
 * @returns {Array<{ role: string, content: string }>} Messages in LLM order (user, assistant, user, ...)
 */
export function readLastGroupExchanges(workspaceDir, groupJid, maxExchanges = 5) {
  if (!workspaceDir || typeof workspaceDir !== 'string') return [];
  const safeId = String(groupJid).trim().replace(/[^0-9-]/g, '_') || 'group';
  const dir = join(workspaceDir, GROUP_CHAT_LOG_DIR, safeId);
  if (!existsSync(dir)) return [];
  let files = [];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
      .map((f) => f.name)
      .sort()
      .reverse();
  } catch (_) {
    return [];
  }
  const all = [];
  for (const name of files) {
    const path = join(dir, name);
    try {
      const content = readFileSync(path, 'utf8');
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t);
          if (row != null && (row.user != null || row.assistant != null))
            all.push({ ts: row.ts || 0, user: String(row.user ?? '').trim(), assistant: String(row.assistant ?? '').trim() });
        } catch (_) {}
      }
    } catch (_) {}
  }
  all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const last = all.slice(-maxExchanges);
  const out = [];
  for (const ex of last) {
    out.push({ role: 'user', content: ex.user || '(no text)' });
    out.push({ role: 'assistant', content: ex.assistant || '(no text)' });
  }
  return out;
}
