/**
 * Browser skill: search the web or fetch a URL.
 * Search: Brave Search API when configured (like OpenClaw), else Playwright + DuckDuckGo Lite.
 * Navigate: Playwright to open a URL and return page text.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config.json');

const BROWSER_TIMEOUT_MS = 20_000;
const MAX_RESULT_CHARS = 12_000;
const BRAVE_SEARCH_BASE = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_SEARCH_COUNT = 8;
const MAX_SEARCH_COUNT = 20;

const BROWSER_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'navigate'],
      description: 'search = run a web search for the query and return snippets. navigate = open a URL and return page text.',
    },
    query: {
      type: 'string',
      description: 'Required for search. The search query (e.g. "recent AI trends 2025").',
    },
    url: {
      type: 'string',
      description: 'Required for navigate. Full URL to open (e.g. https://example.com).',
    },
  },
  required: ['action'],
};

function stripHtmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read search config: skills.browser.search from config.json, and allow apiKey from env.
 * @returns {{ apiKey?: string, count?: number, enabled?: boolean }}
 */
function getBrowserSearchConfig() {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const search = config.skills?.browser?.search;
    if (!search || typeof search !== 'object') {
      return { apiKey: process.env.BRAVE_API_KEY, count: DEFAULT_SEARCH_COUNT };
    }
    const apiKey = search.apiKey ?? process.env.BRAVE_API_KEY;
    const count = Math.min(
      MAX_SEARCH_COUNT,
      Math.max(1, Number(search.count) || DEFAULT_SEARCH_COUNT)
    );
    return { apiKey, count, enabled: search.enabled !== false };
  } catch {
    return { apiKey: process.env.BRAVE_API_KEY, count: DEFAULT_SEARCH_COUNT };
  }
}

/**
 * Brave Search API (same idea as OpenClaw). Returns formatted string of results.
 * @param {string} query - Search query
 * @param {{ apiKey: string, count?: number }} opts
 * @returns {Promise<string>}
 */
async function braveSearch(query, opts = {}) {
  const apiKey = opts.apiKey || process.env.BRAVE_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Brave Search API key required. Set BRAVE_API_KEY in .env or skills.browser.search.apiKey in config.json.');
  }
  const count = Math.min(MAX_SEARCH_COUNT, Math.max(1, opts.count ?? DEFAULT_SEARCH_COUNT));
  const url = new URL(BRAVE_SEARCH_BASE);
  url.searchParams.set('q', query.trim().slice(0, 400));
  url.searchParams.set('count', String(count));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Subscription-Token': apiKey.trim(),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) throw new Error('Brave Search API key invalid or expired.');
    if (res.status === 429) throw new Error('Brave Search rate limit exceeded. Try again in a moment.');
    throw new Error(`Brave Search API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const results = data?.web?.results ?? [];
  if (results.length === 0) {
    return 'No search results found for that query.';
  }

  const lines = results.map((r, i) => {
    const title = (r.title || '').trim() || 'Untitled';
    const desc = (r.description || '').trim();
    const link = (r.url || '').trim();
    const part = link ? `${title}\n${desc ? desc + '\n' : ''}${link}` : `${title}\n${desc}`;
    return `${i + 1}. ${part}`.trim();
  });
  return 'Search results:\n\n' + lines.join('\n\n');
}

/** DuckDuckGo often returns an error/block page for automated requests. Detect and return a clear message. */
function normalizeSearchResult(text) {
  if (!text || typeof text !== 'string') return text;
  const t = text.toLowerCase();
  if (
    t.includes('please email us') ||
    t.includes('anonymized error code') ||
    t.includes('support email address') ||
    t.includes('context of your search')
  ) {
    return 'The search engine returned an error (it often blocks automated requests). Try again in a moment, or ask for a specific topic.';
  }
  return text;
}

/** True if the query is asking for news/headlines (we can use RSS for reliable results). */
function isNewsQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase().trim();
  return (
    /^(top|latest|current|today'?s?|this week'?s?)?\s*(three|3|five|5|ten|10)?\s*(news|headlines)/.test(q) ||
    /\b(news|headlines)\b.*\b(top|latest|three|five|ten)\b/.test(q) ||
    /\b(top|latest)\s*(three|3|five|5)?\s*news\b/.test(q)
  );
}

const NEWS_RSS_URLS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.npr.org/1001/rss.xml',
];

/** Extract <item> or <entry> blocks and then <title> and <link> from RSS XML. */
function parseRssItems(xml, maxItems = 10) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = (m[1] || m[2] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*>([^<]+)<\/link>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const link = linkMatch ? (linkMatch[1] || '').trim() : '';
    if (title) items.push({ title, link });
  }
  return items;
}

/** Fetch top news from public RSS feeds (no API key, no browser). Returns formatted string. */
async function fetchNewsFromRss(maxHeadlines = 10) {
  const allItems = [];
  for (const url of NEWS_RSS_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wa-llm/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml, Math.ceil(maxHeadlines / 2));
      allItems.push(...items);
    } catch (_) {
      continue;
    }
  }
  if (allItems.length === 0) return 'Could not fetch news right now. Try again in a moment.';
  const seen = new Set();
  const unique = allItems.filter((i) => {
    const key = i.title.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const take = unique.slice(0, maxHeadlines);
  const lines = take.map((item, i) => `${i + 1}. ${item.title}${item.link ? ` (${item.link})` : ''}`);
  return 'Top news / headlines:\n\n' + lines.join('\n\n');
}

async function runWithBrowser(fn) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export const browserSkill = {
  id: 'browser',
  name: 'browser',
  description: `Search the web or fetch a page. Use when the user needs current, recent, or real-time information.

Use search for: current time, what's the time, weather today, is it sunny/rainy, today's date, news, trends, latest X. Always call search with a clear query (e.g. "current time", "weather in Mumbai") so you get exact data to reply with.

ACTIONS:
- search: Run a web search for "query". Returns text snippets. Use for time, weather, date, "recent trends", "latest news", etc.
- navigate: Open "url" and return the main text content. Use when the user gives a specific URL to read.`,
  parameters: BROWSER_TOOL_SCHEMA,
  async execute(ctx, args) {
    const action = args?.action && String(args.action).trim().toLowerCase();
    if (!action) throw new Error('action required (search or navigate)');

    if (action === 'search') {
      const query = args?.query && String(args.query).trim();
      if (!query) throw new Error('query required for search');
      // News/headlines: use RSS for reliable results (no search engine blocking).
      if (isNewsQuery(query)) {
        const n = /\b(three|3|five|5|ten|10)\b/.exec(query.toLowerCase());
        const max = n ? { three: 3, 3: 3, five: 5, 5: 5, ten: 10, 10: 10 }[n[1].toLowerCase()] || 5 : 5;
        return fetchNewsFromRss(max);
      }
      // Prefer Brave Search API when configured (structured results, no blocking).
      const searchConfig = getBrowserSearchConfig();
      if (searchConfig.apiKey && searchConfig.enabled !== false) {
        return braveSearch(query, {
          apiKey: searchConfig.apiKey,
          count: searchConfig.count,
        });
      }
      // Fallback: Playwright + DuckDuckGo Lite (no API key).
      return runWithBrowser(async (page) => {
        const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
        const html = await page.content();
        let text = stripHtmlToText(html);
        text = normalizeSearchResult(text);
        const out = text.slice(0, MAX_RESULT_CHARS);
        if (text.length > MAX_RESULT_CHARS) return out + '\n[... truncated]';
        return out || 'No text content found.';
      });
    }

    if (action === 'navigate') {
      const url = args?.url && String(args.url).trim();
      if (!url) throw new Error('url required for navigate');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
      }
      return runWithBrowser(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
        const html = await page.content();
        const text = stripHtmlToText(html);
        const out = text.slice(0, MAX_RESULT_CHARS);
        if (text.length > MAX_RESULT_CHARS) return out + '\n[... truncated]';
        return out || 'No text content found.';
      });
    }

    throw new Error(`Unknown action: ${action}`);
  },
};
