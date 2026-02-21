/**
 * Memory index: SQLite + sqlite-vec for semantic search over MEMORY.md, memory/*.md, and chat history (chat-log/*.jsonl).
 * Chat is auto-indexed on every exchange; no manual sync needed.
 */

import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { embed } from './embeddings.js';
import { appendExchange } from './chat-log.js';

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
 * List chat-log JSONL files (workspace/chat-log/YYYY-MM-DD.jsonl) so sync can index past days.
 * @param {string} workspaceDir
 * @returns {{ relPath: string, mtimeMs: number }[]}
 */
function listChatLogFiles(workspaceDir) {
  const out = [];
  const chatLogDir = join(workspaceDir, 'chat-log');
  try {
    if (!existsSync(chatLogDir) || !statSync(chatLogDir).isDirectory()) return out;
    const names = readdirSync(chatLogDir);
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const full = join(chatLogDir, name);
      try {
        const stat = statSync(full);
        if (stat.isFile()) out.push({ relPath: `chat-log/${name}`, mtimeMs: stat.mtimeMs });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

/**
 * Chunk a chat-log JSONL file into one chunk per line (User/Assistant exchange).
 * @param {string} content - Raw file content
 * @param {string} path - Relative path e.g. chat-log/2025-02-20.jsonl
 * @returns {{ path: string, startLine: number, endLine: number, text: string }[]}
 */
function chunkChatLog(content, path) {
  const lines = content.split('\n').filter((l) => l.trim());
  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const row = JSON.parse(lines[i]);
      const user = (row.user != null ? String(row.user) : '').trim();
      const assistant = (row.assistant != null ? String(row.assistant) : '').trim();
      const text = `User: ${user}\nAssistant: ${assistant}`.trim();
      if (text) chunks.push({ path, startLine: i + 1, endLine: i + 1, text });
    } catch (_) {}
  }
  return chunks;
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
  if (typeof db.defaultSafeIntegers === 'function') db.defaultSafeIntegers(false);
  sqliteVec.load(db);
  if (!vecLoaded) vecLoaded = true;
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
    return dbCache.db;
  }
  if (dimensions > 0 && dbCache.dimensions !== dimensions) {
    try { dbCache.db.close(); } catch (_) {}
    dbCache.db = openDb(indexPath, dimensions);
    dbCache.dimensions = dimensions;
  }
  return dbCache.db;
}

/**
 * If the vec table has BigInt primary keys (legacy), repair it once. Call early in sync so DELETEs don't throw.
 * @param {import('better-sqlite3').Database} db
 * @param {{ baseUrl: string, apiKey: string, model: string }} embeddingConfig
 */
async function repairVecTableIfNeeded(db, embeddingConfig) {
  const probe = db.prepare(`SELECT id FROM ${CHUNKS_TABLE} LIMIT 1`).get();
  if (!probe) return;
  try {
    db.prepare(`SELECT chunk_id FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).get(Number(probe.id));
    return;
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (msg.includes('no such table') || msg.includes('no such module')) return;
    if (!isIntegerPkError(msg)) throw e;
  }
  const row = db.prepare(`SELECT id, text FROM ${CHUNKS_TABLE} LIMIT 1`).get();
  if (!row) {
    try { db.exec(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`); } catch (_) {}
    return;
  }
  const [vec] = await embed([row.text || ''], embeddingConfig);
  if (!vec || vec.length === 0) return;
  console.log('[memory] Rebuilding vec table (integer primary key fix).');
  await rebuildVecTable(db, vec.length, embeddingConfig);
}

/**
 * Sync workspace to index: MEMORY.md + memory/*.md + chat-log/*.jsonl. Chunk, embed, upsert.
 * Chat-log files (including yesterday's) are indexed here so "what did we talk about yesterday?" is answerable.
 * @param {{ workspaceDir: string, indexPath: string, embedding: { baseUrl: string, apiKey: string, model: string }, chunking: { tokens: number, overlap: number } }} config
 */
export async function sync(config) {
  const { workspaceDir, indexPath, embedding, chunking } = config;
  const memoryFiles = listMemoryFiles(workspaceDir);
  const chatLogFiles = listChatLogFiles(workspaceDir);
  const files = [...memoryFiles, ...chatLogFiles];

  const db = getDb(indexPath);
  await repairVecTableIfNeeded(db, embedding);
  if (files.length === 0) return;
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
      try { db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).run(Number(id)); } catch (_) {}
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
    const isChatLog = relPath.startsWith('chat-log/') && relPath.endsWith('.jsonl');
    const chunks = isChatLog ? chunkChatLog(content, relPath) : chunkMarkdown(content, relPath);
    const source = isChatLog ? 'chat' : 'memory';
    if (chunks.length === 0) {
      db.prepare(`INSERT OR REPLACE INTO ${FILES_TABLE} (path, mtime_ms, source) VALUES (?, ?, ?)`).run(relPath, mtimeMs, source);
      continue;
    }

    const texts = chunks.map((c) => c.text);
    let vectors;
    try {
      vectors = await embed(texts, embedding);
    } catch (err) {
      console.log('[memory] Couldn\'t index (embedding service not available).');
      console.error('[memory] Embedding error:', err.message);
      throw err;
    }
    if (vectors.length !== chunks.length) throw new Error('Embed count mismatch');

    const dims = vectors[0].length;
    const dbWithVec = getDb(indexPath, dims);
    dbWithVec.exec('BEGIN');
    try {
      const existingIds = dbWithVec.prepare(`SELECT id FROM ${CHUNKS_TABLE} WHERE path = ?`).all(relPath).map((r) => r.id);
      for (const id of existingIds) {
        try {
          dbWithVec.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).run(Number(id));
        } catch (e) {
          const em = (e && e.message) ? e.message : String(e);
          if (isIntegerPkError(em)) {
            dbWithVec.exec('ROLLBACK');
            console.log('[memory] Rebuilding vec table (integer primary key fix).');
            await rebuildVecTable(dbWithVec, dims, embedding);
            dbWithVec.exec('BEGIN');
            for (const id2 of existingIds) {
              try { dbWithVec.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`).run(Number(id2)); } catch (_) {}
            }
            break;
          }
          throw e;
        }
      }
      dbWithVec.prepare(`DELETE FROM ${CHUNKS_TABLE} WHERE path = ?`).run(relPath);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const ins = dbWithVec.prepare(
          `INSERT INTO ${CHUNKS_TABLE} (path, start_line, end_line, text, source) VALUES (?, ?, ?, ?, ?)`
        ).run(relPath, c.startLine, c.endLine, c.text, source);
        const chunkId = Number(ins.lastInsertRowid);
        dbWithVec.prepare(`INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(chunkId, toBuffer(vectors[i]));
      }
      dbWithVec.prepare(`INSERT OR REPLACE INTO ${FILES_TABLE} (path, mtime_ms, source) VALUES (?, ?, ?)`).run(relPath, mtimeMs, source);
      dbWithVec.exec('COMMIT');
    } catch (e) {
      dbWithVec.exec('ROLLBACK');
      throw e;
    }
  }
}

/**
 * Append exchange to chat log and embed + insert one chunk so "Remember what we said?" can pull from logs.
 * No manual sync: every message is auto-indexed.
 * @param {ReturnType<import('./memory-config.js').getMemoryConfig>} config
 * @param {{ user: string, assistant: string, timestampMs: number, jid?: string }} exchange
 */
export async function indexChatExchange(config, exchange) {
  if (!config) return;
  const { workspaceDir, indexPath, embedding } = config;
  let path; let lineNumber;
  try {
    const out = appendExchange(workspaceDir, exchange);
    path = out.path;
    lineNumber = out.lineNumber;
  } catch (err) {
    console.log('[memory] Couldn\'t save chat log.');
    return;
  }
  const text = `User: ${(exchange.user || '').trim()}\nAssistant: ${(exchange.assistant || '').trim()}`.trim();
  if (!text) return;
  let vectors;
  try {
    vectors = await embed([text], embedding);
  } catch (err) {
    console.log('[memory] Couldn\'t save chat to memory (embedding not available).');
    console.error('[memory] Embedding error:', err.message);
    return;
  }
  const vec = vectors[0];
  if (!vec || vec.length === 0) return;
  const db = getDb(indexPath, vec.length);
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(chunk_id integer primary key, embedding float[${vec.length}]);`);
  } catch (_) {}
  const ins = db.prepare(
    `INSERT INTO ${CHUNKS_TABLE} (path, start_line, end_line, text, source) VALUES (?, ?, ?, ?, 'chat')`
  ).run(path, lineNumber, lineNumber, text);
  const chunkId = Number(ins.lastInsertRowid) || 1;
  db.prepare(`INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(chunkId, toBuffer(vec));
}

function isIntegerPkError(msg) {
  return typeof msg === 'string' && msg.includes('primary key') && msg.includes('chunks_vec');
}

/**
 * One-time repair: rebuild chunks_vec with integer chunk_ids (fixes BigInt-written indexes).
 * @param {import('better-sqlite3').Database} db
 * @param {number} dimensions
 * @param {{ baseUrl: string, apiKey: string, model: string }} embeddingConfig
 */
async function rebuildVecTable(db, dimensions, embeddingConfig) {
  const rows = db.prepare(`SELECT id, text FROM ${CHUNKS_TABLE}`).all();
  try {
    db.exec(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`);
  } catch (_) {}
  db.exec(`CREATE VIRTUAL TABLE ${VECTOR_TABLE} USING vec0(chunk_id integer primary key, embedding float[${dimensions}]);`);
  if (rows.length === 0) return;
  const texts = rows.map((r) => r.text || '');
  const vectors = await embed(texts, embeddingConfig);
  if (vectors.length !== rows.length) return;
  const ins = db.prepare(`INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding) VALUES (CAST(? AS INTEGER), ?)`);
  for (let i = 0; i < rows.length; i++) {
    ins.run(Number(rows[i].id), toBuffer(vectors[i]));
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
  const limit = Math.max(1, Math.floor(Number(maxResults)) || 1);
  let rows;
  try {
    rows = db.prepare(
      `SELECT chunk_id, distance FROM ${VECTOR_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
    ).all(vecBlob, limit);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    if (isIntegerPkError(msg)) {
      console.log('[memory] Rebuilding vec table (integer primary key fix).');
      try {
        await rebuildVecTable(db, queryVec.length, embedding);
        rows = db.prepare(
          `SELECT chunk_id, distance FROM ${VECTOR_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
        ).all(vecBlob, limit);
      } catch (rebuildErr) {
        console.error('[memory] Rebuild failed:', rebuildErr && rebuildErr.message ? rebuildErr.message : rebuildErr);
        throw err;
      }
    } else {
      throw err;
    }
  }

  const results = [];
  for (const row of rows) {
    let score = 1 - row.distance / 2;
    if (score < 0) score = 0;
    if (score < minScore) continue;
    const chunk = db.prepare(`SELECT path, start_line, end_line, text FROM ${CHUNKS_TABLE} WHERE id = ?`).get(Number(row.chunk_id));
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
 * Supports .md (MEMORY.md, memory/*.md) and chat-log/*.jsonl (formatted as "User: ...\nAssistant: ...").
 * @param {string} workspaceDir
 * @param {string} relPath
 * @param {number} [from] - 1-based start line
 * @param {number} [lines] - number of lines
 * @returns {{ text: string, path: string }}
 */
export function readFile(workspaceDir, relPath, from, lines) {
  const normalized = relPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('..') || normalized.includes('/..') || normalized.startsWith('/')) {
    throw new Error('path must be relative to workspace (e.g. MEMORY.md or memory/2025-02-15.md or chat-log/2025-02-16.jsonl)');
  }
  const resolved = join(workspaceDir, normalized);
  const rel = relative(workspaceDir, resolved);
  if (rel.startsWith('..') || rel.includes('..')) throw new Error('path escapes workspace');

  if (normalized.startsWith('chat-log/') && normalized.endsWith('.jsonl')) {
    const content = readFileSync(resolved, 'utf8');
    const lineArr = content.split('\n').filter((l) => l.trim());
    const start = Math.max(0, (from ?? 1) - 1);
    const count = lines ?? lineArr.length;
    const slice = lineArr.slice(start, start + Math.max(1, count));
    const formatted = slice
      .map((line) => {
        try {
          const o = JSON.parse(line);
          return `User: ${(o.user || '').trim()}\nAssistant: ${(o.assistant || '').trim()}`;
        } catch (_) {
          return line;
        }
      })
      .join('\n\n');
    return { text: formatted, path: normalized };
  }

  if (!normalized.endsWith('.md')) throw new Error('Only .md or chat-log/*.jsonl under workspace are allowed');
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
