# cowCode

**Connect chat apps to your local LLM.** You send a message; the bot gets a reply from your chosen model (LM Studio, Ollama, or cloud fallbacks) and sends it back. Minimal setup, no extra features, minimal context per message, so it stays simple and fast. Right now **WhatsApp** is supported (more channels planned).

**Why so little context?** We built this after repeatedly hitting a wall: context windows were never small enough. Long histories and heavy system prompts kept blowing the limit. So this project is deliberately minimal: each turn gets only what’s needed to reply. No conversation buffer, no fancy prompting. That’s the only way it reliably works with smaller or local models.

**Note:** The connected linked device in WhatsApp may show as **Google Chrome (Ubuntu)**. This is due to the library used (Baileys) and is expected; you can ignore it.

## Setup

1. **Install**

   ```bash
   pnpm install
   ```

2. **Link WhatsApp (first time only)**  
   Run the command below, then scan the QR in the terminal with WhatsApp (Linked devices), then Ctrl+C.

   ```bash
   pnpm run auth
   ```

3. **Env (only for cloud models)**  
   If you add OpenAI/Grok/etc. as fallbacks, copy `.env.example` to `.env` and set the API keys there. The first (local) model needs no env.

   ```bash
   cp .env.example .env
   ```

4. **Run**

   ```bash
   pnpm start
   ```

Ensure your LLM server is running (e.g. LM Studio or Ollama with a model loaded) before or when you start.

## Config

**First priority is always local.** Bootstrap `config.json` uses a local provider (e.g. `lmstudio` or `ollama`) first; no URL or API key in `.env` is needed for that.

**Multiple models (priority order):**  
First entry is local (literal values in config). You can set **`baseUrl`** in config **only for local** providers (`lmstudio`, `ollama`) so it’s easy to change port/host; other providers use fixed preset URLs and do not take a URL from config. Any cloud models use env var names and `.env` for secrets.

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

**Priority:** You can set **`"priority": true`** on exactly one model. That model is always tried first, no matter where it appears in the list. If no model has `priority`, the order in the config array is used (first entry first, then fallbacks).

For **cloud** providers set `provider` and `apiKey`; you can set **`model`** in config (e.g. `"model": "gpt-4o"`) or leave it out to use the env var `OPENAI_MODEL` / `GROK_MODEL` / etc., or the built-in default for that provider.

**Built-in providers:**  
`openai`, `grok` / `xai`, `together`, `deepseek`, `ollama`, `lmstudio`. For **local** (`lmstudio`, `ollama`) you can set `baseUrl` in config; for others the URL is preset and not configurable.

**Skills (tools the assistant can use):**  
Scheduling, web search, and other capabilities are implemented as **skills**. In `config.json`, `skills.enabled` is an array of skill ids. By default **cron** and **browser** are enabled. Skills not in `skills.enabled` are not loaded.

```json
"skills": {
  "enabled": ["cron", "browser"],
  "cron": {},
  "browser": {}
}
```

### Where to send messages

- **Ideal for testing:** Open **Message yourself** (your number at the top of the chat list, or “Note to self”). Send a message there; the bot will reply in that same chat.
- **Otherwise:** Any chat where someone else messages the linked number (e.g. a contact messages you); the bot replies in that chat.

### Cron: scheduled messages to WhatsApp

The **cron** skill is enabled by default. You can say things like “remind me to X in 5 minutes”, “send me hello in 1 minute and goodbye in 2 minutes”, or “list my reminders”; the assistant uses the cron tool to add, list, or remove jobs. You can also manage jobs from the CLI:

1. **Add a job** (cron expression = min hour day month weekday; optional timezone):

   ```bash
   pnpm run cron add --name "Morning brief" --cron "0 8 * * *" --message "Summarize today's plan in 3 bullet points."
   pnpm run cron add --name "Reminder" --cron "0 9 * * 1" --tz "America/New_York" --message "Weekly standup in 1 hour."
   ```

2. **List jobs:** `pnpm run cron list`

3. **Remove a job:** `pnpm run cron remove <job-id>`

4. **Enable/disable:** `pnpm run cron enable <job-id>` or `pnpm run cron disable <job-id>`

Jobs are stored in `cron/jobs.json`. **One-shot jobs** (e.g. "send me hi in 30 seconds") are **removed from the file after they run**, so `jobs.json` may be empty even though the cron sent the message—check the terminal for `[cron] One-shot completed and removed from store`. The runner starts when WhatsApp connects (`pnpm start`). By default the reply is sent to your "Message yourself" chat; use `--jid <number@s.whatsapp.net>` to send to a specific chat.

### Browser skill: web search (no API key)

The **browser** skill is enabled by default. It uses **Playwright** to search the web or open a URL when the user asks for current/recent information (e.g. "recent AI trends", "latest news about X", "search for Y"). No Brave or other search API key is required; it runs a headless browser locally. Install Chromium once:

```bash
npx playwright install chromium
```

If the browser binary is missing, search/navigate tool calls will return an error; the assistant will still reply with that. To disable the skill, remove `"browser"` from `skills.enabled` in `config.json`.

### Tests

- **Cron (unit):** `pnpm run test:schedule`
- **Cron (E2E, needs LLM):** `pnpm run test:schedule-e2e`
- **Browser (unit, needs network; skips if no Chromium):** `pnpm run test:browser`
- **Browser (E2E, needs LLM):** `pnpm run test:browser-e2e`
- **Intent classification (needs LLM):** `pnpm run test:intent`

### If linking fails ("can't link device")

- Run `pnpm run auth` and watch the terminal: after you try to scan, a `[disconnect]` line shows the reason (e.g. multi-device not enabled, timeout, etc.).
- Try **pairing with phone number** instead of QR:  
  `pnpm run auth -- --pair 1234567890` (your full number, no +). Then in WhatsApp → Linked devices → "Link with phone number", enter the 8-digit code shown.
