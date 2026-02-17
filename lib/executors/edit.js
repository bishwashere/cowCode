/**
 * Edit skill: replace exact string in file. Fails if no match.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

/**
 * @param {object} ctx - { workspaceDir }
 * @param {object} args - { path, oldString, newString }
 */
export async function executeEdit(ctx, args) {
  const pathArg = args?.path && String(args.path).trim();
  if (!pathArg) return JSON.stringify({ error: 'path is required.' });

  const oldString = args?.oldString;
  const newString = args?.newString != null ? String(args.newString) : '';
  if (oldString === undefined || oldString === null) {
    return JSON.stringify({ error: 'oldString is required.' });
  }
  const oldStr = String(oldString);

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
    if (!content.includes(oldStr)) {
      return JSON.stringify({
        error: 'No exact match for oldString in file. Edit not applied.',
        path: pathArg,
      });
    }
    const parts = content.split(oldStr);
    const count = parts.length - 1;
    const newContent = parts.join(newString);
    writeFileSync(normalized, newContent, 'utf8');
    return JSON.stringify({
      path: pathArg,
      replaced: true,
      count,
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
