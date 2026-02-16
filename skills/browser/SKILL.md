# Browser

Search the web or fetch a page. Use when the user needs current, recent, or real-time information.

## Actions

- **search** — Run a web search for `query`. Returns text snippets. Use for time, weather, date, "recent trends", "latest news", etc. Always call with a clear query (e.g. "current time", "weather in Mumbai").
- **navigate** — Open `url` and return the main text content. Use when the user gives a specific URL to read.

## Config

- Brave Search: set `BRAVE_API_KEY` in .env or `skills.browser.search.apiKey` in config.json.
- Without Brave: news queries use RSS; other queries fall back to Playwright + DuckDuckGo Lite.
