import { getAgentMessagingPolicy, getAgentTitle, listVisibleAgentIds } from './agent-config.js';
import { getEnabledSkillSummaries } from '../skills/loader.js';

const NON_TASK_MESSAGES = new Set([
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank you',
  'ok',
  'okay',
  'cool',
  'great',
]);

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function looksLikeTaskRequest(userText) {
  const text = normalizeText(userText);
  if (!text) return false;
  if (NON_TASK_MESSAGES.has(text)) return false;
  if (text.length <= 16 && NON_TASK_MESSAGES.has(text.replace(/[!?.,]/g, '').trim())) return false;
  return true;
}

function scoreAgentForMessage({ userText, tokens, agentId }) {
  const messageNorm = normalizeText(userText);
  const title = String(getAgentTitle(agentId) || '').trim();
  const titleNorm = normalizeText(title);
  const idNorm = normalizeText(agentId);
  const summaries = getEnabledSkillSummaries({ agentId });
  let score = 0;
  const matchedSkills = [];
  const reasons = [];

  for (const token of tokens) {
    if (idNorm && idNorm.includes(token)) {
      score += 6;
      reasons.push(`token "${token}" matched agent id`);
    }
    if (titleNorm && titleNorm.includes(token)) {
      score += 6;
      reasons.push(`token "${token}" matched agent title`);
    }
  }

  for (const summary of summaries) {
    const skillId = normalizeText(summary?.id || '');
    const desc = normalizeText(summary?.description || '');
    if (!skillId) continue;
    const skillWords = skillId.split(/[-_]/).filter((w) => w.length >= 3);
    let skillScore = 0;

    if (messageNorm.includes(skillId)) {
      skillScore += 10;
    }
    for (const token of tokens) {
      if (skillWords.includes(token)) skillScore += 4;
      else if (desc.includes(token)) skillScore += 2;
    }
    if (skillScore > 0) {
      score += skillScore;
      if (!matchedSkills.includes(summary.id)) matchedSkills.push(summary.id);
    }
  }

  return {
    agentId,
    title,
    score,
    matchedSkills: matchedSkills.slice(0, 8),
    reasons: reasons.slice(0, 6),
  };
}

export function buildDelegationContext({
  agentId = 'main',
  userText = '',
  availableSkillIds = [],
  minScore = 10,
} = {}) {
  if (!Array.isArray(availableSkillIds) || !availableSkillIds.includes('agent-send')) return null;
  if (!looksLikeTaskRequest(userText)) return null;

  const policy = getAgentMessagingPolicy(agentId);
  if (!Array.isArray(policy.allow) || policy.allow.length === 0) return null;
  const visible = new Set(listVisibleAgentIds());
  const eligibleTargets = policy.allow.filter((id) => visible.has(id) && id !== agentId);
  if (eligibleTargets.length === 0) return null;

  const tokens = tokenize(userText);
  const ranked = eligibleTargets
    .map((targetId) => scoreAgentForMessage({ userText, tokens, agentId: targetId }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchedSkills.length !== a.matchedSkills.length) return b.matchedSkills.length - a.matchedSkills.length;
      return a.agentId.localeCompare(b.agentId);
    });

  const best = ranked[0] || null;
  if (!best || best.score < minScore) {
    return {
      candidates: ranked,
      recommendation: null,
    };
  }

  return {
    candidates: ranked,
    recommendation: {
      mode: 'delegate',
      targetAgentId: best.agentId,
      score: best.score,
      matchedSkills: best.matchedSkills,
      reason:
        best.matchedSkills.length > 0
          ? `Best specialization match: ${best.matchedSkills.join(', ')}`
          : 'Best specialization match by profile',
    },
  };
}

