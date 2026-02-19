/**
 * Read skill: return file contents. Peek without touching.
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

/**
 * @param {object} ctx - { workspaceDir }
 * @param {object} args - { path, from?, lines? }
 */
export async function executeRead(ctx, args) {
  let pathArg = args?.path && String(args.path).trim();
  if (!pathArg) return JSON.stringify({ error: 'path is required.' });

  if (pathArg.startsWith('~/') || pathArg === '~') {
    pathArg = join(homedir(), pathArg.slice(1));
  }

  const workspaceDir = ctx.workspaceDir || '';
  const resolved = pathArg.startsWith('/')
    ? pathArg
    : join(workspaceDir, pathArg);
  const normalized = resolve(resolved);

  if (!existsSync(normalized)) {
    return JSON.stringify({ error: `File not found: ${pathArg}` });
  }

  try {
    const content = readFileSync(normalized, 'utf8');
    const lines = content.split(/\r?\n/);
    const from = args?.from != null ? Math.max(1, parseInt(args.from, 10)) : 1;
    const count = args?.lines != null ? Math.max(1, parseInt(args.lines, 10)) : lines.length;
    const start = from - 1;
    const slice = lines.slice(start, start + count);
    const text = slice.join('\n');
    return JSON.stringify({
      path: pathArg,
      from: from,
      lines: slice.length,
      text,
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
