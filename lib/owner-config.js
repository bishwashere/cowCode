/**
 * Bot owner config for group authority: who can approve drastic actions and bypass rate limits.
 * Ownership is defined only by config (the person who set up/controls the bot), not by Telegram
 * group role: we never use group admin or group creator. Read from config.json → owner.telegramUserId.
 */

import { readFileSync, existsSync } from 'fs';
import { getConfigPath } from './paths.js';

/**
 * @returns {{ telegramUserId?: number }} Bot owner config. If telegramUserId is set, that user is the bot owner/creator (DMs for approval, bypass group guards). Not tied to group admin/creator.
 */
export function getOwnerConfig() {
  try {
    const path = getConfigPath();
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, 'utf8');
    if (!raw?.trim()) return {};
    const config = JSON.parse(raw);
    const owner = config.owner;
    if (!owner || typeof owner !== 'object') return {};
    const id = owner.telegramUserId;
    if (id == null) return {};
    const n = typeof id === 'number' ? id : parseInt(String(id), 10);
    if (!Number.isFinite(n)) return {};
    return { telegramUserId: n };
  } catch (_) {
    return {};
  }
}

/**
 * @param {number} telegramUserId
 * @returns {boolean} True if this Telegram user ID is the configured bot owner (from config only; not group admin/creator).
 */
export function isOwner(telegramUserId) {
  if (telegramUserId == null) return false;
  const owner = getOwnerConfig();
  return owner.telegramUserId === Number(telegramUserId);
}
