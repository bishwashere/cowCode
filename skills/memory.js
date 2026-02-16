/**
 * Memory skill: semantic search and read over MEMORY.md and memory/*.md.
 * Exposes two tools: memory_search, memory_get.
 */

import { getMemoryConfig } from '../lib/memory-config.js';
import { getMemoryIndex } from '../lib/memory-index.js';

const MEMORY_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query (e.g. "what did I note about the project?", "preferences for meetings").',
    },
    maxResults: { type: 'number', description: 'Max results to return (default 6).' },
    minScore: { type: 'number', description: 'Minimum similarity score 0–1 (default 0).' },
  },
  required: ['query'],
};

const MEMORY_GET_SCHEMA = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Relative path from memory_search result (e.g. MEMORY.md or memory/2025-02-15.md).',
    },
    from: { type: 'number', description: '1-based start line (optional).' },
    lines: { type: 'number', description: 'Number of lines to read (optional).' },
  },
  required: ['path'],
};

export const memorySkill = {
  id: 'memory',
  name: 'memory_search',
  description: 'Semantically search MEMORY.md and memory/*.md for prior work, decisions, preferences, or todos. Returns snippets with path and line range. Use before answering questions about past context.',
  parameters: MEMORY_SEARCH_SCHEMA,
  tools: [
    {
      name: 'memory_search',
      description: 'Semantically search MEMORY.md and memory/*.md for prior work, decisions, preferences, or todos. Returns snippets with path and line range. Use before answering questions about past context.',
      parameters: MEMORY_SEARCH_SCHEMA,
    },
    {
      name: 'memory_get',
      description: 'Read a snippet from MEMORY.md or memory/*.md by path (from memory_search) and optional line range. Use after memory_search to pull only needed lines.',
      parameters: MEMORY_GET_SCHEMA,
    },
  ],
  async execute(ctx, args, toolName) {
    const config = getMemoryConfig();
    if (!config) {
      return JSON.stringify({ error: 'Memory is not configured. Add "memory" to skills.enabled and set an embedding API key (e.g. OpenAI).' });
    }
    const index = getMemoryIndex(config);
    if (!index) {
      return JSON.stringify({ error: 'Memory index unavailable.' });
    }
    const workspaceDir = ctx.workspaceDir || config.workspaceDir;
    if (!workspaceDir) {
      return JSON.stringify({ error: 'Workspace path not set.' });
    }

    if (toolName === 'memory_search') {
      const query = (args?.query && String(args.query).trim()) || '';
      if (!query) {
        return JSON.stringify({ error: 'query is required.', results: [] });
      }
      try {
        const results = await index.search(query);
        const maxResults = Math.min(20, Math.max(1, Number(args?.maxResults) || config.search.maxResults));
        const minScore = Number(args?.minScore) ?? config.search.minScore;
        const filtered = results.filter((r) => r.score >= minScore).slice(0, maxResults);
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
      if (!path) {
        return JSON.stringify({ error: 'path is required.', text: '' });
      }
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

    return JSON.stringify({ error: `Unknown memory tool: ${toolName}` });
  },
};
