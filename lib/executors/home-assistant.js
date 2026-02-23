/**
 * Home Assistant executor: list_states, get_state, call_service via REST API.
 * Uses HA_URL and HA_TOKEN from environment (loaded from ~/.cowcode/.env when run as daemon).
 */

import dotenv from 'dotenv';
import { getEnvPath } from '../paths.js';

const TIMEOUT_MS = 15_000;

/** Default when HA_URL is not set (Home Assistant default port). */
const DEFAULT_HA_URL = 'http://localhost:8123';

let haEnvLoaded = false;

/** Ensure HA_URL and HA_TOKEN are in process.env; load .env from state dir if missing (daemon case). */
function ensureHaEnv() {
  if (process.env.HA_TOKEN) return; // token is the only required one; URL has a default
  if (haEnvLoaded) return;
  haEnvLoaded = true;
  try {
    dotenv.config({ path: getEnvPath() });
  } catch (_) {}
}

function getBaseUrl() {
  ensureHaEnv();
  const url = (process.env.HA_URL || DEFAULT_HA_URL).trim().replace(/\/+$/, '') || DEFAULT_HA_URL;
  const token = (process.env.HA_TOKEN || '').trim();
  if (!token) throw new Error('Home Assistant token is not set. Set HA_TOKEN (long-lived access token) in the environment.');
  return { url, token };
}

/**
 * @param {string} path - e.g. /api/states
 * @param {{ method?: string, body?: object }} [opts]
 */
async function haFetch(path, opts = {}) {
  const { url: base, token } = getBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const init = {
    method: opts.method || 'GET',
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (opts.body != null && (opts.method === 'POST' || opts.method === 'PUT')) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Home Assistant API ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {object} ctx - { workspaceDir, jid, ... }
 * @param {object} args - LLM tool args (action/command, domain?, entity_id?, service?, service_data?)
 */
export async function executeHomeAssistant(ctx, args) {
  const action = (args?.action && String(args.action).trim()) ||
    (args?.command && String(args.command).trim()) || '';
  const act = action.toLowerCase().replace(/\s+/g, '_');

  if (act === 'list_states' || act === 'list') {
    const domain = (args?.domain && String(args.domain).trim()) || '';
    const data = await haFetch('/api/states');
    const list = Array.isArray(data) ? data : [];
    let filtered = list;
    if (domain) {
      const d = domain.replace(/^\./, '');
      filtered = list.filter((s) => s && String(s.entity_id || '').startsWith(d + '.'));
    }
    if (filtered.length === 0) {
      return JSON.stringify({
        message: domain ? `No entities in domain "${domain}".` : 'No entities returned.',
        entities: [],
      });
    }
    const summary = filtered.slice(0, 100).map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      attributes: s.attributes ? { friendly_name: s.attributes.friendly_name } : {},
    }));
    return JSON.stringify({
      message: `Found ${filtered.length} entity(ies)${domain ? ` in domain "${domain}"` : ''}.`,
      entities: summary,
      total: filtered.length,
    });
  }

  if (act === 'get_state') {
    const entityId = (args?.entity_id && String(args.entity_id).trim()) || '';
    if (!entityId) throw new Error('get_state requires arguments.entity_id (e.g. light.living_room).');
    const encoded = entityId.split('.').map((s) => encodeURIComponent(s)).join('.');
    const data = await haFetch(`/api/states/${encoded}`);
    if (data == null) throw new Error(`Entity ${entityId} not found.`);
    return JSON.stringify({
      entity_id: data.entity_id,
      state: data.state,
      attributes: data.attributes || {},
    });
  }

  if (act === 'call_service' || act === 'call' || act === 'service') {
    const domain = (args?.domain && String(args.domain).trim()) || '';
    const service = (args?.service && String(args.service).trim()) || '';
    if (!domain || !service) {
      throw new Error('call_service requires arguments.domain and arguments.service (e.g. domain: light, service: turn_on).');
    }
    const entityId = args?.entity_id;
    const serviceData = args?.service_data && typeof args.service_data === 'object' ? args.service_data : {};
    const body = { ...serviceData };
    if (entityId != null) body.entity_id = entityId;
    const url = `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
    const data = await haFetch(url, { method: 'POST', body });
    return JSON.stringify({
      message: `Called ${domain}.${service}${entityId ? ` on ${entityId}` : ''}.`,
      result: data,
    });
  }

  return JSON.stringify({
    error: `Unknown action: ${action}. Use one of: list_states, get_state, call_service.`,
  });
}
