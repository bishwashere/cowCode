# cowCode

**Connect chat apps to your local LLM.** You send a message; the bot gets a reply from your chosen model (LM Studio, Ollama, or cloud fallbacks) and sends it back. Minimal setup, no extra features—minimal context per message, so it stays simple and fast. Right now **WhatsApp** is supported (more channels planned).

**Note:** The connected linked device in WhatsApp may show as **Google Chrome (Ubuntu)**. This is due to the library used (Baileys) and is expected; you can ignore it.

## Setup

1. **Install**  
   `pnpm install`

2. **Link WhatsApp (first time only)**  
   `pnpm run auth` — scan the QR in the terminal with WhatsApp (Linked devices), then Ctrl+C.

3. **Env (only for cloud models)**  
   If you add OpenAI/Grok/etc. as fallbacks, copy `.env.example` to `.env` and set the API keys there. The first (local) model needs no env.

4. **Run**  
   `pnpm start`

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

### Where to send messages

- **Ideal for testing:** Open **Message yourself** (your number at the top of the chat list, or “Note to self”). Send a message there; the bot will reply in that same chat.
- **Otherwise:** Any chat where someone else messages the linked number (e.g. a contact messages you); the bot replies in that chat.

### If linking fails ("can't link device")

- Run `pnpm run auth` and watch the terminal: after you try to scan, a `[disconnect]` line shows the reason (e.g. multi-device not enabled, timeout, etc.).
- Try **pairing with phone number** instead of QR:  
  `pnpm run auth -- --pair 1234567890` (your full number, no +). Then in WhatsApp → Linked devices → "Link with phone number", enter the 8-digit code shown.
