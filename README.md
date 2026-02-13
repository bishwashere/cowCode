# cowCode

WhatsApp bot that replies using your local or cloud LLM (LM Studio, Ollama, OpenAI, etc.). Chat in “Message yourself”; the bot answers there.

**Requirements:** Node ≥18. Your LLM server (e.g. LM Studio) should be running when you start the bot. Setup works with npm or pnpm; if pnpm isn’t installed, it uses npm.

---

## 1. Get the repo

```bash
git clone https://github.com/bishwashere/cowCode
cd cowCode
```

---

## 2. Setup (first time only)

```bash
pnpm run setup
```

*(No pnpm? Use `npm run setup` or `node setup.js`. Setup will install deps with npm.)*

- Installs dependencies, asks for local LLM base URL and optional API keys (Brave, OpenAI), then starts the app.
- If WhatsApp isn’t linked yet, scan the QR code with WhatsApp → Linked devices. The bot starts after that.

---

## 3. Everyday start

```bash
pnpm start
```

Use this whenever you want to run the bot again. No need to run setup unless you change config or re-link.

---

**Tips:** Reply in “Message yourself”. You can say “remind me in 5 minutes” or “search for X”; cron and web search are on by default. If linking fails, run `pnpm run auth -- --pair 1234567890` and use “Link with phone number” in WhatsApp.

---

## Config & features

### Config (`config.json`)

**First priority is always local.** The default config uses a local provider (e.g. `lmstudio` or `ollama`) first; no URL or API key in `.env` is needed for that.

**Multiple models (priority order):**  
You can set **`baseUrl`** in config **only for local** providers (`lmstudio`, `ollama`). Cloud models use env var names and `.env` for secrets.

```json
{
  "llm": {
    "maxTokens": 2048,
    "models": [
      { "provider": "lmstudio", "baseUrl": "http://127.0.0.1:1234/v1", "model": "local", "apiKey": "not-needed" },
      { "provider": "openai", "apiKey": "LLM_1_API_KEY", "model": "gpt-4o", "priority": true },
      { "provider": "grok", "apiKey": "LLM_2_API_KEY", "model": "grok-2" }
    ]
  }
}
```

**Priority:** Set **`"priority": true`** on exactly one model. That model is always tried first. If none has `priority`, the array order is used.

**Built-in providers:**  
`openai`, `grok` / `xai`, `together`, `deepseek`, `ollama`, `lmstudio`. For **local** (`lmstudio`, `ollama`) you can set `baseUrl` in config; for others the URL is preset.

**Skills:**  
In `config.json`, `skills.enabled` lists which skills are on (default: `["cron", "browser"]`). Remove a name to disable that skill.

```json
"skills": {
  "enabled": ["cron", "browser"],
  "cron": {},
  "browser": { "search": { "provider": "brave", "count": 8 } }
}
```

### Where to send messages

- **Message yourself** (or “Note to self”): send there; the bot replies in that same chat.
- **Other chats:** The bot replies when someone messages the linked number (e.g. a contact messages you).

### Cron: scheduled messages

The **cron** skill is on by default. Say “remind me to X in 5 minutes”, “list my reminders”, etc. From the CLI:

- **Add:** `pnpm run cron add --name "Morning brief" --cron "0 8 * * *" --message "Summarize today's plan."`
- **List:** `pnpm run cron list`
- **Remove:** `pnpm run cron remove <job-id>`
- **Enable/disable:** `pnpm run cron enable <job-id>` / `pnpm run cron disable <job-id>`

Jobs are in `cron/jobs.json`. One-shot jobs are removed after they run.

### Browser skill: web search

The **browser** skill is on by default. It searches the web or opens a URL when the user asks for current info (e.g. “recent AI trends”, “search for X”).

- **With Brave API key:** set `BRAVE_API_KEY` in `.env` (or enter in setup). Search uses the Brave Search API.
- **Without Brave key:** the app falls back to Playwright. Run `npx playwright install chromium` once.

### Tests

- **Cron (unit):** `pnpm run test:schedule`
- **Cron (E2E, needs LLM):** `pnpm run test:schedule-e2e`
- **Browser (unit):** `pnpm run test:browser`
- **Browser (E2E, needs LLM):** `pnpm run test:browser-e2e`
- **Intent (needs LLM):** `pnpm run test:intent`

### If linking fails

- Run `pnpm run auth` and check the terminal: a `[disconnect]` line shows the reason (e.g. multi-device not enabled).
- **Pair with phone number:** `pnpm run auth -- --pair 1234567890` (full number, no +). In WhatsApp → Linked devices → “Link with phone number”, enter the 8-digit code.

**Note:** The linked device may show as “Google Chrome (Ubuntu)” (Baileys); you can ignore it.
