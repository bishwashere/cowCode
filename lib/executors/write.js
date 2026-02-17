/**
 * Write skill: create or replace a file with given content.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';

/**
 * @param {object} ctx - { workspaceDir }
 * @param {object} args - { path, content }
 */
export async function executeWrite(ctx, args) {
  const pathArg = args?.path && String(args.path).trim();
  if (!pathArg) return JSON.stringify({ error: 'path is required.' });

  const content = args?.content != null ? String(args.content) : '';
  const workspaceDir = ctx.workspaceDir || '';
  const resolved = pathArg.startsWith('/')
    ? pathArg
    : join(workspaceDir, pathArg);
  const normalized = resolve(resolved);

  try {
    const dir = dirname(normalized);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(normalized, content, 'utf8');
    return JSON.stringify({
      path: pathArg,
      written: true,
      size: Buffer.byteLength(content, 'utf8'),
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
