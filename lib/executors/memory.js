/**
 * Memory executor: runs memory_search / memory_get / memory_save from LLM-provided args.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import { getMemoryConfig } from '../memory-config.js';
import { getMemoryIndex } from '../memory-index.js';

const SNIPPET_MAX_CHARS = 700;

/** True if the query or args suggest the user is asking about "yesterday" (or a specific past date). */
function asksAboutYesterday(query, args) {
  const q = (query || '').toLowerCase();
  if (/yesterday|last night|the other day|previous (day|conversation|chat)/i.test(q)) return true;
  if (args?.date && String(args.date).toLowerCase() === 'yesterday') return true;
  return false;
}

/** YYYY-MM-DD for yesterday (server date). */
function yesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * Read chat-log/YYYY-MM-DD.jsonl and return one result per exchange (path, startLine, endLine, snippet, score).
 * Used when the user asks about "yesterday" so we don't rely on semantic match for that word.
 */
function resultsFromChatLogFile(workspaceDir, dateStr) {
  const relPath = `chat-log/${dateStr}.jsonl`;
  const fullPath = join(workspaceDir, relPath);
  if (!existsSync(fullPath)) return [];
  let content = '';
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch (_) {
    return [];
  }
  const lines = content.split('\n').filter((l) => l.trim());
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const row = JSON.parse(lines[i]);
      const user = (row.user != null ? String(row.user) : '').trim();
      const assistant = (row.assistant != null ? String(row.assistant) : '').trim();
      const text = `User: ${user}\nAssistant: ${assistant}`.trim();
      if (!text) continue;
      const snippet = text.length > SNIPPET_MAX_CHARS ? text.slice(0, SNIPPET_MAX_CHARS) + '…' : text;
      results.push({
        path: relPath,
        startLine: i + 1,
        endLine: i + 1,
        snippet,
        score: 0.5,
      });
    } catch (_) {}
  }
  return results;
}

/**
 * @param {object} ctx - { workspaceDir }
 * @param {object} args - LLM tool args
 * @param {string} toolName - memory_search | memory_get
 */
export async function executeMemory(ctx, args, toolName) {
  const config = getMemoryConfig();
  if (!config) {
    return JSON.stringify({ error: 'Memory is not configured. Add "memory" to skills.enabled and set an embedding API key (e.g. OpenAI).' });
  }
  const index = getMemoryIndex(config);
  if (!index) return JSON.stringify({ error: 'Memory index unavailable.' });
  const workspaceDir = ctx.workspaceDir || config.workspaceDir;
  if (!workspaceDir) return JSON.stringify({ error: 'Workspace path not set.' });

  if (toolName === 'memory_search') {
    const query = (args?.query && String(args.query).trim()) || '';
    if (!query) return JSON.stringify({ error: 'query is required.', results: [] });
    try {
      const results = await index.search(query);
      const maxResults = Math.min(20, Math.max(1, Number(args?.maxResults) || config.search.maxResults));
      const minScore = Number(args?.minScore) ?? config.search.minScore;
      let filtered = results.filter((r) => r.score >= minScore).slice(0, maxResults);

      // When the user asks about "yesterday", semantic search often returns no chat-log hits
      // because the word "yesterday" doesn't appear in the conversation. Add yesterday's
      // chat-log file as results so the agent can answer.
      if (asksAboutYesterday(query, args)) {
        const yesterdayResults = resultsFromChatLogFile(workspaceDir, yesterdayDateStr());
        if (yesterdayResults.length > 0) {
          const fromSemantic = filtered.filter((r) => r.path.startsWith('chat-log/'));
          const hasChatLogFromSemantic = fromSemantic.length > 0;
          if (!hasChatLogFromSemantic || fromSemantic.every((r) => !r.path.includes(yesterdayDateStr()))) {
            filtered = [...yesterdayResults.slice(0, maxResults), ...filtered]
              .slice(0, maxResults);
          }
        }
      }

      return JSON.stringify({
        results: filtered.map((r) => ({
          path: r.path,
          startLine: r.startLine,
          endLine: r.endLine,
          snippet: r.snippet,
          score: Math.round(r.score * 100) / 100,
        })),
      });
    } catch (err) {
      console.error('[memory] search failed:', err.message);
      return JSON.stringify({ error: err.message, results: [] });
    }
  }

  if (toolName === 'memory_get') {
    const path = (args?.path && String(args.path).trim()) || '';
    if (!path) return JSON.stringify({ error: 'path is required.', text: '' });
    const from = args?.from != null ? Number(args.from) : undefined;
    const lines = args?.lines != null ? Number(args.lines) : undefined;
    try {
      const out = index.readFile(path, from, lines);
      return JSON.stringify({ path: out.path, text: out.text });
    } catch (err) {
      console.error('[memory] readFile failed:', err.message);
      return JSON.stringify({ error: err.message, path, text: '' });
    }
  }

  if (toolName === 'memory_save') {
    const text = (args?.text && String(args.text).trim()) || '';
    if (!text) return JSON.stringify({ error: 'text is required for memory_save.' });

    // Resolve target file — default MEMORY.md, or a caller-specified .md path.
    let targetRelPath = (args?.file && String(args.file).trim()) || 'MEMORY.md';
    targetRelPath = targetRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!targetRelPath.endsWith('.md')) {
      return JSON.stringify({ error: 'file must be a .md path (e.g. MEMORY.md or memory/notes.md).' });
    }
    const resolved = join(workspaceDir, targetRelPath);
    const rel = relative(workspaceDir, resolved);
    if (rel.startsWith('..') || rel.includes('..')) {
      return JSON.stringify({ error: 'file must be within the workspace directory.' });
    }

    try {
      const dir = dirname(resolved);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const now = new Date();
      const dateStr = now.getFullYear() + '-'
        + String(now.getMonth() + 1).padStart(2, '0') + '-'
        + String(now.getDate()).padStart(2, '0');
      const line = `- ${dateStr}: ${text}\n`;
      appendFileSync(resolved, line, 'utf8');

      // Re-sync so the saved note is immediately searchable.
      try { await index.sync(); } catch (_) {}

      return JSON.stringify({ saved: true, file: targetRelPath, text });
    } catch (err) {
      console.error('[memory] memory_save failed:', err.message);
      return JSON.stringify({ error: err.message });
    }
  }

  return JSON.stringify({ error: `Unknown memory tool: ${toolName}` });
}
