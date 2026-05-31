/**
 * Inject dashboard Projects tracker data into agent system prompts.
 */

import { listProjects } from './projects-db.js';

const MAX_PROJECTS = 30;

function summarize(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * @param {Array<{ name?: string, description?: string, url?: string }>} projects
 * @returns {string}
 */
export function formatProjectsForPrompt(projects) {
  const list = Array.isArray(projects) ? projects : [];
  if (!list.length) {
    return 'No projects in the dashboard Projects tracker yet (user can add them on the Projects page).';
  }
  return list.slice(0, MAX_PROJECTS).map((p, i) => {
    const name = String(p.name || 'Untitled').trim();
    const desc = summarize(p.description, 160);
    const url = String(p.url || '').trim();
    let line = `${i + 1}. **${name}**`;
    if (desc) line += ` — ${desc}`;
    if (url) line += ` — ${url}`;
    return line;
  }).join('\n');
}

/**
 * Short line for me-skill profile prose.
 * @returns {string}
 */
export function formatProjectsProfileLine() {
  try {
    const projects = listProjects();
    if (!projects.length) return '';
    const names = projects.slice(0, 12).map((p) => {
      const name = String(p.name || 'Untitled').trim();
      const desc = summarize(p.description, 60);
      return desc ? `${name} (${desc})` : name;
    });
    const more = projects.length > 12 ? ` and ${projects.length - 12} more` : '';
    return `You have ${projects.length} project${projects.length === 1 ? '' : 's'} in the dashboard Projects tracker: ${names.join(', ')}${more}.`;
  } catch (_) {
    return '';
  }
}

/**
 * System-prompt block listing tracked projects (always include when available).
 * @returns {string}
 */
export function buildProjectsContextBlock() {
  try {
    const projects = listProjects();
    const body = formatProjectsForPrompt(projects);
    return (
      '\n\n# Dashboard projects (Projects tracker)\n' +
      'Authoritative list from the cowCode dashboard **Projects** page (`projects.db` in the state dir). ' +
      'When the user asks what projects they have, their main projects, or what they are working on in the tracker, answer from this list. ' +
      'Do **not** say you do not know their projects if entries appear below. For older notes or semantic search, also use **memory** or **me**.\n\n' +
      body
    );
  } catch (err) {
    console.log('[projects-context] failed:', err?.message || err);
    return '';
  }
}
