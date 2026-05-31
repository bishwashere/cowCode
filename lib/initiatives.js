import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getInitiativesStorePath } from './paths.js';
import { readTeamActivityWindow } from './team-activity.js';

const VALID_TYPES = new Set(['opportunity', 'risk', 'question', 'experiment', 'improvement', 'observation']);
const VALID_STATUS = new Set(['open', 'accepted', 'rejected', 'completed']);
const MIN_CONFIDENCE = 0.6;
const MAX_INITIATIVES_PER_TICK = 2;
const MAX_INITIATIVES_PER_DAY = 20;

function nowMs() {
  return Date.now();
}

function summarize(text, maxLen = 320) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}...` : s;
}

function randomId() {
  return `init-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase();
  return VALID_TYPES.has(t) ? t : 'observation';
}

function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return VALID_STATUS.has(s) ? s : 'open';
}

function safeArray(values, max = 20) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v || '').trim()).filter(Boolean).slice(0, max);
}

function normalizeInitiative(row = {}) {
  const id = String(row.id || '').trim();
  return {
    id: id || randomId(),
    title: summarize(row.title || 'Untitled initiative', 140),
    type: normalizeType(row.type),
    description: summarize(row.description || '', 2500),
    source: summarize(row.source || 'goal_reflection', 120),
    confidence: normalizeConfidence(row.confidence),
    status: normalizeStatus(row.status),
    createdBy: summarize(row.createdBy || 'main', 80) || 'main',
    relatedGoalIds: safeArray(row.relatedGoalIds, 40),
    activity: safeArray(row.activity, 60),
    specialistReviews: safeArray(row.specialistReviews, 30),
    createdAt: Number(row.createdAt) || nowMs(),
    updatedAt: Number(row.updatedAt) || nowMs(),
  };
}

function readStore() {
  const path = getInitiativesStorePath();
  try {
    if (!existsSync(path)) return { initiatives: [], updatedAt: 0, analysis: { lastTeamScanAt: 0 } };
    const parsed = JSON.parse(readFileSync(path, 'utf8') || '{}');
    return {
      initiatives: Array.isArray(parsed.initiatives) ? parsed.initiatives.map(normalizeInitiative) : [],
      updatedAt: Number(parsed.updatedAt) || 0,
      analysis: parsed.analysis && typeof parsed.analysis === 'object'
        ? { lastTeamScanAt: Number(parsed.analysis.lastTeamScanAt) || 0 }
        : { lastTeamScanAt: 0 },
    };
  } catch {
    return { initiatives: [], updatedAt: 0, analysis: { lastTeamScanAt: 0 } };
  }
}

function writeStore(store) {
  const path = getInitiativesStorePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    initiatives: Array.isArray(store.initiatives) ? store.initiatives.map(normalizeInitiative) : [],
    updatedAt: nowMs(),
    analysis: store.analysis && typeof store.analysis === 'object'
      ? { lastTeamScanAt: Number(store.analysis.lastTeamScanAt) || 0 }
      : { lastTeamScanAt: 0 },
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function dedupeKey(init) {
  const title = String(init.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${normalizeType(init.type)}::${title}`;
}

function countInitiativesToday(rows, now = nowMs()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return rows.filter((r) => Number(r.createdAt) >= start.getTime()).length;
}

export function listInitiatives() {
  const store = readStore();
  return {
    initiatives: store.initiatives.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    updatedAt: store.updatedAt || 0,
  };
}

export function getInitiative(initiativeId) {
  const id = String(initiativeId || '').trim();
  if (!id) return null;
  return readStore().initiatives.find((i) => i.id === id) || null;
}

export function updateInitiative(initiativeId, patch = {}) {
  const id = String(initiativeId || '').trim();
  if (!id) throw new Error('initiative id is required');
  const store = readStore();
  const idx = store.initiatives.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`Initiative not found: ${id}`);
  const prev = store.initiatives[idx];
  const next = normalizeInitiative({
    ...prev,
    ...patch,
    id,
    updatedAt: nowMs(),
    relatedGoalIds: Array.isArray(patch.relatedGoalIds)
      ? Array.from(new Set([...prev.relatedGoalIds, ...safeArray(patch.relatedGoalIds, 40)]))
      : prev.relatedGoalIds,
    activity: Array.isArray(patch.activity)
      ? Array.from(new Set([...prev.activity, ...safeArray(patch.activity, 60)])).slice(-60)
      : prev.activity,
    specialistReviews: Array.isArray(patch.specialistReviews)
      ? Array.from(new Set([...prev.specialistReviews, ...safeArray(patch.specialistReviews, 30)])).slice(-30)
      : prev.specialistReviews,
  });
  store.initiatives[idx] = next;
  writeStore(store);
  return next;
}

export function createInitiatives(candidates = [], opts = {}) {
  const source = summarize(opts.source || 'goal_reflection', 120);
  const createdBy = summarize(opts.createdBy || 'main', 80) || 'main';
  const relatedGoalIds = safeArray(opts.relatedGoalIds, 20);
  const maxPerBatch = Math.max(1, Math.min(10, Number(opts.maxPerBatch) || MAX_INITIATIVES_PER_TICK));
  const threshold = Math.max(0, Math.min(1, Number(opts.minConfidence) || MIN_CONFIDENCE));
  const now = nowMs();
  const store = readStore();
  const all = Array.isArray(store.initiatives) ? store.initiatives.slice() : [];
  const todayCount = countInitiativesToday(all, now);
  if (todayCount >= MAX_INITIATIVES_PER_DAY) return { created: [], merged: [], discarded: ['daily_limit'] };

  const openByKey = new Map();
  all.forEach((row) => {
    if (row.status === 'open' || row.status === 'accepted') openByKey.set(dedupeKey(row), row);
  });

  const created = [];
  const merged = [];
  const discarded = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (created.length >= maxPerBatch) break;
    const conf = normalizeConfidence(raw && raw.confidence);
    if (conf < threshold) {
      discarded.push('low_confidence');
      continue;
    }
    const normalized = normalizeInitiative({
      ...raw,
      source: raw?.source || source,
      createdBy: raw?.createdBy || createdBy,
      relatedGoalIds: [
        ...safeArray(raw?.relatedGoalIds, 20),
        ...relatedGoalIds,
      ],
      status: 'open',
      createdAt: now,
      updatedAt: now,
      activity: [`Created from ${source}`],
    });
    if (!normalized.title) {
      discarded.push('missing_title');
      continue;
    }
    const key = dedupeKey(normalized);
    const existing = openByKey.get(key);
    if (existing) {
      const patched = updateInitiative(existing.id, {
        confidence: Math.max(existing.confidence, normalized.confidence),
        relatedGoalIds: normalized.relatedGoalIds,
        activity: [`Merged duplicate from ${source}`],
      });
      merged.push(patched);
      continue;
    }
    all.push(normalized);
    openByKey.set(key, normalized);
    created.push(normalized);
  }
  if (created.length) writeStore({ ...store, initiatives: all });
  return { created, merged, discarded };
}

export function analyzeTeamActivityForInitiatives(opts = {}) {
  const now = nowMs();
  const minIntervalMs = Math.max(30 * 60_000, Number(opts.minIntervalMs) || (3 * 60 * 60_000));
  const store = readStore();
  if (now - Number(store.analysis?.lastTeamScanAt || 0) < minIntervalMs) {
    return { skipped: 'interval', created: [], merged: [] };
  }
  const events = readTeamActivityWindow({ maxBytes: 1024 * 1024, maxEvents: 8000 });
  const since = now - (6 * 60 * 60_000);
  const recent = events.filter((e) => Number(e.ts) >= since);
  const blocked = recent.filter((e) => e.type === 'goal_tick_error' || e.type === 'delegation_error' || e.type === 'skill_error');
  const byMessage = new Map();
  blocked.forEach((e) => {
    const key = summarize(e.message || e.type, 120).toLowerCase();
    byMessage.set(key, (byMessage.get(key) || 0) + 1);
  });
  const repeated = Array.from(byMessage.entries()).filter(([, count]) => count >= 3).slice(0, 4);
  const candidates = repeated.map(([msg, count]) => ({
    title: `Reduce repeated failure: ${msg.slice(0, 50)}`,
    type: 'improvement',
    description: `Detected ${count} repeated failures in recent team activity. Consider shared mitigation.`,
    confidence: Math.min(0.95, 0.65 + (count * 0.05)),
    source: 'team_activity_analysis',
  }));
  const result = createInitiatives(candidates, {
    source: 'team_activity_analysis',
    createdBy: 'main',
    minConfidence: 0.6,
    maxPerBatch: 3,
  });
  writeStore({
    ...readStore(),
    analysis: { lastTeamScanAt: now },
  });
  return result;
}
