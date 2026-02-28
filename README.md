# cowCode

<div align="center">
  <img width="320" height="320" alt="cowCode" src="https://github.com/user-attachments/assets/7d245e10-8172-4956-bc29-aaba9e30aa10" />
</div>

**cowCode - your private AI companion**

🔒 Full control | 🖥 Runs on your computer | 🚫 No external routing | ⚙️ You decide what connects


---

## 1️⃣ Install · Mac, Linux, Windows

```bash
curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash
```

**Windows:** Use **Git Bash** and [Node.js](https://nodejs.org/). [Git Bash](https://gitforwindows.org/) if needed.

| 2️⃣ Start the Bot | 3️⃣ Dashboard | 4️⃣ Other commands |
|----------------------------------------|--------------|-------------------|
| <code>cowcode moo start</code> | <code>cowcode dashboard</code>  | <code>cowcode logs</code> - view bot logs<br><code>cowcode update</code> - latest version<br><code>cowcode uninstall</code> - remove cowCode |
| You can close the terminal. It keeps running. | Open dashboard | Other utility commands are here |

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

# 🧠 What You Can Say

| Reminders & time | Search & browse | Vision & pages | Memory & files |
|------------------|-----------------|----------------|-----------------|
| remind me in 5 minutes | search for AI trends | describe what's on that page | summarize my notes |
| remind me tomorrow at 9am | what's the weather | show me what you see (webcam) | what did we decide yesterday? |
| every Monday at 8am remind me to standup | open example.com and tell me what's there | screenshot the page | what did I note about the project? |
| list my reminders | go to that URL, click the button | describe this image | read main.py |
| cancel reminder number 2 | fill the form and submit | what's in the room? | save this to notes.md |
| set a reminder in 2 hours for groceries | find news about X | take a screenshot | in config.json replace X with Y |
| what's scheduled? | scroll down the page | what do you see? | list files in my workspace |


---

# ⚙️ Requirements

* Node.js 18+
* Local LLM running (LM Studio, Ollama, etc.)
* Or cloud API key

---

# 🌊 Tide (periodic check)

Tide runs the agent after the chat has been quiet for a while (no user message needed). Configure in `~/.cowcode/config.json`:

```json
"tide": {
  "enabled": true,
  "silenceCooldownMinutes": 60,
  "inactiveStart": "23:00",
  "inactiveEnd": "06:00"
}
```

* **enabled** — Tide is in the default config but off (`false`). Set to `true` to enable.
* **silenceCooldownMinutes** — Both how often we check and how long the chat must be silent before pinging (default 30). We only wake up every N minutes and only send if there’s been no message in or out for at least N minutes.
* **jid** — Where to send the agent’s reply (your WhatsApp JID or Telegram chat id). If omitted, Tide auto-detects: with Telegram it uses the bot owner's private chat (config.owner.telegramUserId), or the most recently active private chat. Set only to override (e.g. a specific WhatsApp JID).
* **inactiveStart** — 24h time (e.g. `"23:00"`). Tide will not run at or after this time (in your local timezone from `agents.defaults.userTimezone`).
* **inactiveEnd** — 24h time (e.g. `"06:00"`). Tide will not run before this time. With `inactiveStart` after `inactiveEnd`, this defines an overnight quiet window (e.g. 11 PM–6 AM).

Tide is designed to be quietly helpful: it only speaks after real silence, keeps messages short and tied to recent context (e.g. “Still no reply on that—should I follow up?” or “Tests passed. What’s next?”), and does not double-text if you don’t answer.

---

# 📌 That's It

Private.
Secure.
Runs on your computer.
Works with WhatsApp and Telegram.
Easy to install.
Easy to update.

cowCode keeps AI simple.

Paths are relative to the workspace (`~/.cowcode/workspace/`) unless absolute.

---
