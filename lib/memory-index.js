/**
 * Memory index: SQLite + sqlite-vec for semantic search over MEMORY.md and memory/*.md.
 */

import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { embed } from './embeddings.js';

function toBuffer(arr) {
  const vec = new Float32Array(arr);
  return Buffer.from(vec.buffer);
}

const VECTOR_TABLE = 'chunks_vec';
const CHUNKS_TABLE = 'chunks';
const FILES_TABLE = 'files';
const SNIPPET_MAX_CHARS = 700;
const CHUNK_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 80;

let dbCache = null;
let vecLoaded = false;

/**
 * Ensure directory exists.
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Chunk markdown text into segments with line ranges. Uses fixed char size + overlap.
 * @param {string} fullText
 * @param {string} path - Relative path for the file
 * @returns {{ path: string, startLine: number, endLine: number, text: string }[]}
 */
export function chunkMarkdown(fullText, path) {
  const lines = fullText.split('\n');
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let charCount = 0;
    while (end < lines.length && (charCount < CHUNK_CHARS || end === start)) {
      charCount += (lines[end] || '').length + 1;
      end++;
    }
    const segment = lines.slice(start, end).join('\n');
    if (segment.trim()) {
      chunks.push({
        path,
        startLine: start + 1,
        endLine: end,
        text: segment,
      });
    }
    start = Math.max(start + 1, end - Math.floor(CHUNK_OVERLAP_CHARS / 20));
  }
  return chunks;
}

/**
 * List memory markdown files under workspaceDir.
 * @param {string} workspaceDir
 * @returns {{ relPath: string, mtimeMs: number }[]}
 */
function listMemoryFiles(workspaceDir) {
  const out = [];
  try {
    const memoryMd = join(workspaceDir, 'MEMORY.md');
    if (existsSync(memoryMd)) {
      const stat = statSync(memoryMd);
      if (stat.isFile()) out.push({ relPath: 'MEMORY.md', mtimeMs: stat.mtimeMs });
    }
    const memoryAlt = join(workspaceDir, 'memory.md');
    if (existsSync(memoryAlt)) {
      const stat = statSync(memoryAlt);
      if (stat.isFile()) out.push({ relPath: 'memory.md', mtimeMs: stat.mtimeMs });
    }
    const memoryDir = join(workspaceDir, 'memory');
    if (existsSync(memoryDir) && statSync(memoryDir).isDirectory()) {
      const names = readdirSync(memoryDir);
      for (const name of names) {
        if (!name.endsWith('.md')) continue;
        const full = join(memoryDir, name);
        try {
          const stat = statSync(full);
          if (stat.isFile()) out.push({ relPath: `memory/${name}`, mtimeMs: stat.mtimeMs });
        } catch (_) {}
      }
    }
  } catch (_) {}
  return out;
}

/**
 * Open database and ensure schema. Load sqlite-vec.
 * @param {string} indexPath
 * @param {number} dimensions - Vector dimension (set after first embed)
 * @returns {import('better-sqlite3').Database}
 */
function openDb(indexPath, dimensions = 0) {
  ensureDir(join(indexPath, '..'));
  const db = new Database(indexPath);
  if (!vecLoaded) {
    sqliteVec.load(db);
    vecLoaded = true;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${FILES_TABLE} (
      path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory'
    );
    CREATE TABLE IF NOT EXISTS ${CHUNKS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory'
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON ${CHUNKS_TABLE}(path);
  `);
  if (dimensions > 0) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(chunk_id integer primary key, embedding float[${dimensions}]);`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!msg.includes('already exists')) throw e;
    }
  }
  return db;
}

/**
 * Get or create cached DB for this indexPath. Creates vector table when dimensions known.
 * @param {string} indexPath
 * @param {number} [dimensions]
 */
function getDb(indexPath, dimensions = 0) {
  if (!dbCache || dbCache.path !== indexPath) {
    if (dbCache) {
      try { dbCache.db.close(); } catch (_) {}
    }
    dbCache = { path: indexPath, db: openDb(indexPath, dimensions), dimensions: dimensions || null };
  }
  if (dimensions > 0 && dbCache.dimensions !== dimensions) {
    dbCache.dimensions = dimensions;
    openDb(indexPath, dimensions);
  }
  return dbCache.db;
}

/**
 * Sync workspace markdown to index: chunk, embed, upsert.
 * @param {{ workspaceDir: string, indexPath: string, embedding: { baseUrl: string, apiKey: string, model: string }, chunking: { tokens: number, overlap: number } }} config
 */
export async function sync(config) {
  const { workspaceDir, indexPath, embedding, chunking } = config;
  const files = listMemoryFiles(workspaceDir);
  if (files.length === 0) return;

  const db = getDb(indexPath);
  const existingFiles = new Map();
  try {
    const rows = db.prepare(`SELECT path, mtime_ms FROM ${FILES_TABLE}`).all();
    for (const r of rows) existingFiles.set(r.path, r.mtime_ms);
  } catch (_) {}

  const toProcess = [];
  for (const { relPath, mtimeMs } of files) {
    const prev = existingFiles.get(relPath);
    if (prev === mtimeMs) continue;
    toProcess.push({ relPath, mtimeMs });
  }

  const toDelete = [];
  for (const path of existingFiles.keys()) {
    if (!files.some((f) => f.relPath === path)) toDelete.push(path);
  }

  for (const path of toDelete) {
    const ids = db.prepare(`SELECT id FROM ${CHUNKS_TABLE} WHERE path = ?`).all(path).map((r) => r.id);
    for (const id of ids) {
      try { db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).run(id); } catch (_) {}
    }
    db.prepare(`DELETE FROM ${CHUNKS_TABLE} WHERE path = ?`).run(path);
    db.prepare(`DELETE FROM ${FILES_TABLE} WHERE path = ?`).run(path);
  }

  for (const { relPath, mtimeMs } of toProcess) {
    const fullPath = join(workspaceDir, relPath);
    let content = '';
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch (_) {
      continue;
    }
    const chunks = chunkMarkdown(content, relPath);
    if (chunks.length === 0) {
      db.prepare(`INSERT OR REPLACE INTO ${FILES_TABLE} (path, mtime_ms, source) VALUES (?, ?, 'memory')`).run(relPath, mtimeMs);
      continue;
    }

    const texts = chunks.map((c) => c.text);
    let vectors;
    try {
      vectors = await embed(texts, embedding);
    } catch (err) {
      console.error('[memory] embed failed:', err.message);
      throw err;
    }
    if (vectors.length !== chunks.length) throw new Error('Embed count mismatch');

    const dims = vectors[0].length;
    const dbWithVec = getDb(indexPath, dims);
    dbWithVec.exec('BEGIN');
    try {
      const existingIds = dbWithVec.prepare(`SELECT id FROM ${CHUNKS_TABLE} WHERE path = ?`).all(relPath).map((r) => r.id);
      for (const id of existingIds) {
        try { dbWithVec.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).run(id); } catch (_) {}
      }
      dbWithVec.prepare(`DELETE FROM ${CHUNKS_TABLE} WHERE path = ?`).run(relPath);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const ins = dbWithVec.prepare(
          `INSERT INTO ${CHUNKS_TABLE} (path, start_line, end_line, text, source) VALUES (?, ?, ?, ?, 'memory')`
        ).run(relPath, c.startLine, c.endLine, c.text);
        const chunkId = ins.lastInsertRowid;
        dbWithVec.prepare(`INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding) VALUES (?, ?)`).run(chunkId, toBuffer(vectors[i]));
      }
      dbWithVec.prepare(`INSERT OR REPLACE INTO ${FILES_TABLE} (path, mtime_ms, source) VALUES (?, ?, 'memory')`).run(relPath, mtimeMs);
      dbWithVec.exec('COMMIT');
    } catch (e) {
      dbWithVec.exec('ROLLBACK');
      throw e;
    }
  }
}

/**
 * Search by query embedding. Returns top snippets.
 * @param {string} query
 * @param {{ workspaceDir: string, indexPath: string, embedding: object, search: { maxResults: number, minScore: number } }} config
 * @returns {Promise<{ path: string, startLine: number, endLine: number, snippet: string, score: number }[]>}
 */
export async function search(query, config) {
  const { workspaceDir, indexPath, embedding, search: searchOpts } = config;
  const maxResults = searchOpts?.maxResults ?? 6;
  const minScore = searchOpts?.minScore ?? 0;

  const [queryVec] = await embed([query.trim()], embedding);
  if (!queryVec || queryVec.length === 0) return [];

  const db = getDb(indexPath, queryVec.length);
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(chunk_id integer primary key, embedding float[${queryVec.length}]);`);
  } catch (_) {}

  const vecBlob = toBuffer(queryVec);
  const rows = db.prepare(
    `SELECT chunk_id, distance FROM ${VECTOR_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
  ).all(vecBlob, maxResults);

  const results = [];
  for (const row of rows) {
    let score = 1 - row.distance / 2;
    if (score < 0) score = 0;
    if (score < minScore) continue;
    const chunk = db.prepare(`SELECT path, start_line, end_line, text FROM ${CHUNKS_TABLE} WHERE id = ?`).get(row.chunk_id);
    if (!chunk) continue;
    const snippet = (chunk.text || '').slice(0, SNIPPET_MAX_CHARS) + ((chunk.text || '').length > SNIPPET_MAX_CHARS ? '…' : '');
    results.push({
      path: chunk.path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      snippet,
      score,
    });
  }
  return results;
}

/**
 * Read file under workspace by relative path. Optional line range.
 * @param {string} workspaceDir
 * @param {string} relPath
 * @param {number} [from] - 1-based start line
 * @param {number} [lines] - number of lines
 * @returns {{ text: string, path: string }}
 */
export function readFile(workspaceDir, relPath, from, lines) {
  const normalized = relPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('..') || normalized.includes('/..') || normalized.startsWith('/')) {
    throw new Error('path must be relative to workspace (e.g. MEMORY.md or memory/2025-02-15.md)');
  }
  if (!normalized.endsWith('.md')) throw new Error('Only .md files under workspace are allowed');
  const full = join(workspaceDir, normalized);
  const resolved = join(workspaceDir, normalized);
  const rel = relative(workspaceDir, resolved);
  if (rel.startsWith('..') || rel.includes('..')) throw new Error('path escapes workspace');
  const content = readFileSync(resolved, 'utf8');
  if (from == null && lines == null) return { text: content, path: normalized };
  const lineArr = content.split('\n');
  const start = Math.max(1, (from ?? 1)) - 1;
  const count = Math.max(1, (lines ?? lineArr.length));
  const slice = lineArr.slice(start, start + count).join('\n');
  return { text: slice, path: normalized };
}

/**
 * Get memory index interface: sync, search, readFile. Lazy init of DB on first sync/search.
 * @param {ReturnType<import('./memory-config.js').getMemoryConfig>} config - From getMemoryConfig()
 * @returns {{ sync: ()=>Promise<void>, search: (q:string)=>Promise<object[]>, readFile: (path:string, from?:number, lines?:number)=>object } | null}
 */
export function getMemoryIndex(config) {
  if (!config) return null;
  return {
    async sync() {
      await sync(config);
    },
    async search(query) {
      await sync(config);
      return search(query, config);
    },
    readFile(relPath, from, lines) {
      return readFile(config.workspaceDir, relPath, from, lines);
    },
  };
}
