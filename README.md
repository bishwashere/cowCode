# cowCode

WhatsApp bot that replies using your **local or cloud LLM** (LM Studio, Ollama, OpenAI, etc.).
You chat in **"Message yourself"**, and the bot replies there.

---

# 🚀 Install (Do This First)

### 1️⃣ Install

```bash
curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash
```

### 2️⃣ Start the bot in the background (recommended)

From **any terminal**:

```bash
cowcode moo start
```

The bot runs in the background. **You can close the terminal** — it keeps running (macOS: launchd, Linux: systemd).

If `cowcode` is not found, add `export PATH="$HOME/.local/bin:$PATH"` to your shell config (e.g. `~/.bashrc` or `~/.zshrc`).

**Code** is installed to **`~/.local/share/cowcode`** (fixed path, like OpenClaw). **Config and state** (config, WhatsApp auth, cron jobs) live in **`~/.cowcode`**. Override install path with `COWCODE_INSTALL_DIR` when running the install script.

Other commands: `cowcode moo stop` | `cowcode moo status` | `cowcode moo restart`.

That's it.

---

# 🔄 Update (get the latest code)

From anywhere (keeps your config in `~/.cowcode`):

```bash
cowcode update
```

Then start as usual: `cowcode moo start`

If you installed to a custom path and don't use the `cowcode` launcher, run from the install directory:

```bash
cd ~/.local/share/cowcode && curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/update.sh | bash
```

---

# 💬 How to Use

• Open WhatsApp
• Go to **Message yourself** (or "Note to self")
• Send a message
• The bot replies in the same chat

You can say things like:

* "remind me in 5 minutes"
* "search for AI trends"
* "summarize today's tasks"

Cron reminders and web search are already enabled.

---

# 🔗 If WhatsApp Linking Fails

Run:

```bash
cowcode auth --pair 1234567890
```

(or from the cowCode folder: `npm run auth -- --pair 1234567890`)

Replace with your full phone number (no +).

Then in WhatsApp:
Settings → Linked Devices → **Link with phone number** → enter the 8-digit code.

---

# ⚙️ Basic Requirements

• Node.js 18 or newer
• Your local LLM (like LM Studio or Ollama) must be running before starting the bot
• npm, pnpm, or yarn

---

# 🧠 LLM Configuration (Optional)

File: **`~/.cowcode/config.json`** (or `$COWCODE_STATE_DIR/config.json`).

Local models are tried first by default.

Example:

```json
{
  "llm": {
    "maxTokens": 2048,
    "models": [
      { "provider": "lmstudio", "baseUrl": "http://127.0.0.1:1234/v1", "model": "local" },
      { "provider": "openai", "apiKey": "LLM_1_API_KEY", "model": "gpt-4o", "priority": true }
    ]
  }
}
```

Rules:
• Set `"priority": true` on one model if you want it always tried first
• Local providers (lmstudio, ollama) use `baseUrl`
• Cloud providers use API keys in `.env`

Built-in providers:
openai, grok/xai, together, deepseek, ollama, lmstudio

---

# 🛠 Skills (On by Default)

Configured in `~/.cowcode/config.json`.

```json
"skills": {
  "enabled": ["cron", "browser", "memory"]
}
```

Remove a skill name to disable it.

---

# ⏰ Reminders (Cron)

Say:

* "remind me to call John in 10 minutes"
* "list my reminders"

CLI commands:

```bash
pnpm run cron list
pnpm run cron remove <job-id>
```

Jobs are stored in **`~/.cowcode/cron/jobs.json`**.

---

# 🔄 Moo commands (background service)

`cowcode moo start` is the recommended way to run the bot (see Install step 2). Full set:

```bash
cowcode moo start    # start in background (survives closing terminal)
cowcode moo stop
cowcode moo status
cowcode moo restart
```

First time: link WhatsApp once with `cowcode auth` (or during setup when the QR appears). Then `cowcode moo start` runs the bot in the background.

Code is in `~/.local/share/cowcode`; you can run `cowcode moo start` from anywhere.

---

# 🌐 Web Search (Browser Skill)

Default search provider: Brave.

If you have a Brave API key:

```
BRAVE_API_KEY=your_key_here
```

If not:

```bash
npx playwright install chromium
```

The bot will automatically search the web when needed.

---

# 🧠 Memory (Optional)

The bot can search and read from your notes in **`~/.cowcode/workspace/`**:

* **`MEMORY.md`** — main notes file
* **`memory/*.md`** — e.g. `memory/2025-02-15.md` for dated notes

Add `"memory"` to `skills.enabled` in config. For semantic search the bot uses an **embedding API** (same key as your LLM if you use OpenAI). Put the key in `.env` (e.g. `LLM_1_API_KEY` or `LLM_API_KEY`). Optional config:

```json
"memory": {
  "embedding": { "provider": "openai", "model": "text-embedding-3-small" },
  "search": { "maxResults": 6 }
}
```

If `memory.embedding` is omitted, the first LLM model’s provider and API key are used. Then ask things like “what did I note about the project?” or “what are my preferences for meetings?” — the bot will use **memory_search** and **memory_get** to answer from your markdown.

---

# 🧪 Tests (Optional)

```bash
pnpm run test:browser
pnpm run test:browser-e2e
pnpm run test:cron-e2e
pnpm run test:all
```

---

# 📌 Where Messages Work

• Message yourself → replies there
• Other chats → replies when someone messages your linked number

---

That's all you need to start using cowCode.
