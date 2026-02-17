# cowCode

Private AI bot for **WhatsApp and Telegram**.

Runs **on your own computer**.
Uses your **local or cloud LLM**.
Nothing is sent anywhere unless you configure it.

Simple. Secure. Direct.

You message the bot.
It replies.

---

# 🚀 Install (Do This First)

## 1️⃣ One Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash
```

That's it.

---

## 2️⃣ Start the Bot

```bash
cowcode moo start
```

It runs in the background.

You can close the terminal.
It keeps running.

<img width="1024" height="1024" alt="ChatGPT Image Feb 16, 2026, 11_19_56 AM" src="https://github.com/user-attachments/assets/7d245e10-8172-4956-bc29-aaba9e30aa10" />

---

# 🔐 Private & Secure

* Runs locally on your machine
* WhatsApp and Telegram connect directly
* Config and data stay in `~/.cowcode`
* Local models are used first by default
* No external servers required

Your AI.
Your machine.
Your control.

---

# 💬 How It Works

Choose one or both:

* WhatsApp
* Telegram

You chat normally.
The bot replies in that same chat.

---

## WhatsApp

Open WhatsApp →
Message yourself →
Send a message →
Bot replies there.

---

## Telegram

Message your Telegram bot.
Bot replies instantly.

You can use both at the same time.

Reminders stay on the same channel you created them.

---

# 🔄 Update

Get latest version anytime:

```bash
cowcode update
```

Your config, auth, and skills stay safe. No fresh install needed. New default skills (e.g. browse, vision, memory) are added automatically on next start. If you use a text-only LLM and want image reading, re-run setup to configure the vision fallback.

---

# 📦 Where Things Live

**Code**

```
~/.local/share/cowcode
```

**Config, auth, reminders**

```
~/.cowcode
```

Everything stays on your computer.

---

# ➕ Add Telegram Later

Add this to:

```
~/.cowcode/.env
```

```
TELEGRAM_BOT_TOKEN=your_token_here
```

Then:

```bash
cowcode moo start
```

---

# ➕ Add WhatsApp Later

```bash
cowcode auth
cowcode moo start
```

---

# 🧠 What You Can Say

* remind me in 5 minutes
* search for AI trends
* summarize my notes
* list my reminders
* open https://example.com and tell me what’s there
* go to that URL, click the button, and screenshot the page

**Search** finds info (text in, text out). **Browse** controls a local headless browser: navigate URLs, click, scroll, fill forms, take screenshots. **Vision** reads images: when you send a photo in chat, when the agent has an image path (e.g. from a browse screenshot), or from the **live webcam** ("Show me what you see" → describes the room). Built-in chaining: screenshot → vision → act (no need to say "describe this then click"). Cron, search, browse, and vision are enabled by default.

---

# ⚙️ Requirements

* Node.js 18+
* Local LLM running (LM Studio, Ollama, etc.)
* Or cloud API key

---

# 🧩 Optional Configuration

File:

```
~/.cowcode/config.json
```

During setup you choose a **cloud LLM** (OpenAI, Grok, or Anthropic) and a **model version** (e.g. GPT-4o, Claude 3.5 Sonnet). The installer offers recommended/latest options per provider.

Local models are tried first.

Cloud models run only if configured.

---

# 📧 Google Workspace (gog Skill)

Install the `gog` CLI and complete OAuth:

```bash
gog auth credentials /path/to/client_secret.json
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,sheets,docs
gog auth list
```

Enable the skill and set a default account (optional):

```json
"skills": {
	"enabled": ["cron", "search", "browse", "vision", "memory", "gog"],
	"gog": { "account": "you@gmail.com" }
}
```

For automation, use `--json` and `--no-input`. The assistant will ask for confirmation before sending mail or creating calendar events.

---

# ⏰ Reminders

Example:

remind me to call John in 10 minutes

Stored locally:

```
~/.cowcode/cron/jobs.json
```

---

# 🧠 Memory (Optional)

**Chat history baked in** — "Remember what we said yesterday?" pulls from logs. **Auto-indexing** — every message you send gets embedded; no manual "moo index."

Add notes in `~/.cowcode/workspace/` (e.g. `MEMORY.md`, `memory/*.md`). Conversations are stored in `workspace/chat-log/` and indexed automatically. Ask: *what did I note about the project?* or *what did we decide yesterday?* — the bot searches both notes and chat history.

---

# 🛠 Background Service

```bash
cowcode moo start
cowcode moo stop
cowcode moo status
cowcode moo restart
```

Runs like a proper system service.

---

# 📌 That's It

Private.
Secure.
Runs on your computer.
Works with WhatsApp and Telegram.
Easy to install.
Easy to update.

cowCode keeps AI simple.
