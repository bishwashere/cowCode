import { getAgentMessagingPolicy, getAgentTitle, getAgentAliases, listVisibleAgentIds, resolveAgentReference } from './agent-config.js';
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

function stemToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/(ing|ers|er|ed|tion|s)$/g, '')
    .trim();
}

function hasFuzzyTokenMatch(token, textNorm) {
  const t = stemToken(token);
  if (!t || t.length < 4) return false;
  if (textNorm.includes(t)) return true;
  const words = textNorm.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const sw = stemToken(w);
    if (!sw) continue;
    const minLen = Math.min(sw.length, t.length);
    if (minLen >= 5 && sw.slice(0, minLen) === t.slice(0, minLen)) return true;
    if (minLen >= 5 && (sw.startsWith(t.slice(0, 5)) || t.startsWith(sw.slice(0, 5)))) return true;
  }
  return false;
}

function normalizeConceptToken(token) {
  const t = stemToken(token);
  if (!t) return '';
  if (t.startsWith('market')) return 'marketing';
  if (t.startsWith('brand')) return 'branding';
  if (t.startsWith('camp')) return 'campaigns';
  if (t.startsWith('blog')) return 'blogging';
  return t;
}

function detectExplicitTargetAgent(userText, callerAgentId, visibleAgentIds) {
  const textNorm = normalizeText(userText);
  if (!textNorm) return '';
  const tokenSet = new Set(tokenize(textNorm));

  // First pass: direct token-based resolution (e.g. "ask alex").
  for (const token of tokenSet) {
    const resolved = resolveAgentReference(token);
    if (resolved && resolved !== callerAgentId && visibleAgentIds.includes(resolved)) return resolved;
  }

  // Second pass: explicit id/title mention.
  for (const agentId of visibleAgentIds) {
    if (agentId === callerAgentId) continue;
    if (textNorm.includes(agentId.toLowerCase())) return agentId;
    const title = normalizeText(getAgentTitle(agentId));
    if (title && textNorm.includes(title)) return agentId;
  }

  return '';
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
  const aliasNorms = getAgentAliases(agentId).map((a) => normalizeText(a)).filter(Boolean);
  const summaries = getEnabledSkillSummaries({ agentId });
  let score = 0;
  const matchedSkills = [];
  const reasons = [];
  const matchedConcepts = [];

  for (const token of tokens) {
    if (idNorm && idNorm.includes(token)) {
      score += 6;
      reasons.push(`token "${token}" matched agent id`);
      const c = normalizeConceptToken(token);
      if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
    }
    if (idNorm && hasFuzzyTokenMatch(token, idNorm)) {
      score += 5;
      reasons.push(`token "${token}" fuzzily matched agent id`);
      const c = normalizeConceptToken(token);
      if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
    }
    if (titleNorm && titleNorm.includes(token)) {
      score += 6;
      reasons.push(`token "${token}" matched agent title`);
      const c = normalizeConceptToken(token);
      if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
    }
    if (titleNorm && hasFuzzyTokenMatch(token, titleNorm)) {
      score += 5;
      reasons.push(`token "${token}" fuzzily matched agent title`);
      const c = normalizeConceptToken(token);
      if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
    }
    for (const aliasNorm of aliasNorms) {
      if (aliasNorm.includes(token)) {
        score += 5;
        reasons.push(`token "${token}" matched agent alias`);
        const c = normalizeConceptToken(token);
        if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
      } else if (hasFuzzyTokenMatch(token, aliasNorm)) {
        score += 5;
        reasons.push(`token "${token}" fuzzily matched agent alias`);
        const c = normalizeConceptToken(token);
        if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
      }
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
      const c = normalizeConceptToken(skillId);
      if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
    }
    for (const token of tokens) {
      if (skillWords.includes(token)) {
        skillScore += 4;
        const c = normalizeConceptToken(token);
        if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
      } else if (desc.includes(token)) {
        skillScore += 2;
        const c = normalizeConceptToken(token);
        if (c && !matchedConcepts.includes(c)) matchedConcepts.push(c);
      }
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
    matchedConcepts: matchedConcepts.slice(0, 8),
    reasons: reasons.slice(0, 6),
  };
}

function withConfidence(ranked) {
  if (!Array.isArray(ranked) || ranked.length === 0) return [];
  const positive = ranked.map((c) => ({ ...c, score: Number(c.score || 0) }));
  const total = positive.reduce((acc, c) => acc + Math.max(0, c.score), 0);
  if (total <= 0) {
    const even = 1 / positive.length;
    return positive.map((c) => ({ ...c, confidence: Number(even.toFixed(4)) }));
  }
  return positive.map((c) => ({
    ...c,
    confidence: Number((Math.max(0, c.score) / total).toFixed(4)),
  }));
}

function buildReason(best) {
  const concepts = Array.isArray(best?.matchedConcepts) ? best.matchedConcepts.filter(Boolean) : [];
  if (concepts.length > 0) {
    return `Request contains ${concepts.slice(0, 3).join(', ')} concepts.`;
  }
  const skills = Array.isArray(best?.matchedSkills) ? best.matchedSkills.filter(Boolean) : [];
  if (skills.length > 0) {
    return `Best specialization match on skills: ${skills.slice(0, 3).join(', ')}.`;
  }
  return 'Best specialization match by profile.';
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
  const visibleTargets = listVisibleAgentIds().filter((id) => id !== agentId);
  const explicitTarget = detectExplicitTargetAgent(userText, agentId, visibleTargets);
  if (explicitTarget && !eligibleTargets.includes(explicitTarget)) {
    const explicitRank = withConfidence([{ agentId: explicitTarget, title: getAgentTitle(explicitTarget), score: 100, matchedSkills: [], matchedConcepts: [] }])[0];
    return {
      candidates: explicitRank ? [explicitRank] : [],
      recommendation: {
        mode: 'delegate',
        targetAgentId: explicitTarget,
        score: 100,
        confidence: 1,
        matchedSkills: [],
        matchedConcepts: [],
        blocked: true,
        reason: `User explicitly requested ${explicitTarget}, but it is not linked from ${agentId}.`,
      },
    };
  }
  if (explicitTarget && eligibleTargets.includes(explicitTarget)) {
    const explicitRank = withConfidence([{ agentId: explicitTarget, title: getAgentTitle(explicitTarget), score: 100, matchedSkills: [], matchedConcepts: [] }])[0];
    return {
      candidates: explicitRank ? [explicitRank] : [],
      recommendation: {
        mode: 'delegate',
        targetAgentId: explicitTarget,
        score: 100,
        confidence: 1,
        matchedSkills: [],
        matchedConcepts: [],
        reason: `User explicitly requested ${explicitTarget}.`,
      },
    };
  }

  const tokens = tokenize(userText);
  const ranked = withConfidence(eligibleTargets
    .map((targetId) => scoreAgentForMessage({ userText, tokens, agentId: targetId }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchedSkills.length !== a.matchedSkills.length) return b.matchedSkills.length - a.matchedSkills.length;
      return a.agentId.localeCompare(b.agentId);
    }));

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
      confidence: Number(best.confidence || 0),
      matchedSkills: best.matchedSkills,
      matchedConcepts: best.matchedConcepts,
      reason: buildReason(best),
    },
  };
}

