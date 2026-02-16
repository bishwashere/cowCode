# Search

Search the web or fetch a page. Call **run_skill** with **skill: "search"**. The **command name** is the operation: use **command** or **arguments.action** set to exactly one of: **search**, **navigate**.

## Commands (name is command)

- **search** — For current time, weather, date, latest news, or any live query. Set **arguments.query** (e.g. "current time", "weather in Tokyo", "latest news"). Use a clear, concrete query.
- **navigate** — When the user gives a specific URL to read. Set **arguments.url** (full http or https URL).

You can pass the command at the top level (`command: "search"`) or inside arguments (`arguments.action: "search"`). Never omit the command/action.

## Config

- Brave Search: set `BRAVE_API_KEY` in .env or `skills.search.apiKey` in config.json (or `skills.browser.search.apiKey` for backward compatibility).
- Without Brave: news queries use RSS; other queries fall back to Playwright + DuckDuckGo Lite.
