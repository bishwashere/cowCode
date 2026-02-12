# wa-llm

WhatsApp + configurable LLM. Receives messages, gets a reply from your chosen backend, sends it back. No tools, no extra features.

This works seamlessly with a **local LLM** (e.g. LM Studio, Ollama): each message is sent to your model and the reply is posted back to WhatsApp with minimal context—no long history or heavy prompting, so it stays simple and fast.

**Note:** The connected linked device in WhatsApp may show as **Google Chrome (Ubuntu)**. This is due to the library used (Baileys) and is expected; you can ignore it.

## Setup

1. **Install**  
   `pnpm install`

2. **Link WhatsApp (first time only)**  
   `pnpm run auth` — scan the QR in the terminal with WhatsApp (Linked devices), then Ctrl+C.

3. **Run**  
   `pnpm start`

Ensure your LLM server is running (e.g. LM Studio or Ollama with a model loaded) before or when you start.

## Config

Edit `config.json`:

```json
{
  "llm": {
    "baseUrl": "http://127.0.0.1:1234/v1",
    "apiKey": "not-needed",
    "model": "local",
    "maxTokens": 2048
  }
}
```

Or override with env: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.

### Examples

- **LM Studio** (default): `baseUrl: "http://127.0.0.1:1234/v1"`, `model: "local"`.
- **Ollama**: `baseUrl: "http://127.0.0.1:11434/v1"`, `model: "llama3.2"` (or any model you have).
- **OpenAI**: `baseUrl: "https://api.openai.com/v1"`, `apiKey: "sk-..."`, `model: "gpt-4o"` (or set `LLM_API_KEY` in env).

Any OpenAI-compatible API works: same URL + optional key + model id.

### Where to send messages

- **Ideal for testing:** Open **Message yourself** (your number at the top of the chat list, or “Note to self”). Send a message there; the bot will reply in that same chat.
- **Otherwise:** Any chat where someone else messages the linked number (e.g. a contact messages you); the bot replies in that chat.

### If linking fails ("can't link device")

- Run `pnpm run auth` and watch the terminal: after you try to scan, a `[disconnect]` line shows the reason (e.g. multi-device not enabled, timeout, etc.).
- Try **pairing with phone number** instead of QR:  
  `pnpm run auth -- --pair 1234567890` (your full number, no +). Then in WhatsApp → Linked devices → "Link with phone number", enter the 8-digit code shown.
