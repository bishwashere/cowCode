# cowCode

WhatsApp bot that replies using your **local or cloud LLM** (LM Studio, Ollama, OpenAI, etc.).
You chat in **"Message yourself"**, and the bot replies there.

---

# 🚀 Install (Do This First)

### 1️⃣ Install

```bash
curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash
```

### 2️⃣ Start the bot (every time you want to use it)

From **any terminal** (no need to cd into the folder):

```bash
cowcode
```

Or from the cowCode folder: `npm start` (or `pnpm start` / `yarn start`).  
If `cowcode` isn’t found, add `export PATH="$HOME/.local/bin:$PATH"` to your shell config (e.g. `~/.bashrc` or `~/.zshrc`).

**Config and state** (config, WhatsApp auth, cron jobs) live in **`~/.cowcode`**. Override with `COWCODE_STATE_DIR`.

That's it.

---

# 🔄 Update (get the latest code)

From inside your cowCode folder (keeps your config, WhatsApp link, and reminders):

```bash
cd cowCode && curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/update.sh | bash
```

Then start as usual: `cowcode`

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
  "enabled": ["cron", "browser"]
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

# 🔄 Run in the background (optional)

Run the bot in the background so it keeps working after you close the terminal (macOS: launchd, Linux: systemd).

```bash
cowcode moo start
cowcode moo stop
cowcode moo status
cowcode moo restart
```

First time: link WhatsApp once with `cowcode auth` (or run the bot once in the foreground to scan the QR). Then `cowcode moo start` runs the bot in the background.

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

# 🧪 Tests (Optional)

```bash
pnpm run test:browser
pnpm run test:browser-e2e
pnpm run test:all
```

---

# 📌 Where Messages Work

• Message yourself → replies there
• Other chats → replies when someone messages your linked number

---

That's all you need to start using cowCode.
