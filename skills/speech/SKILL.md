# Speech

Voice-to-text via **Whisper** (OpenAI) and text-to-voice via **11Labs**. Use when the user wants to transcribe audio, convert speech to text, or generate spoken audio from text.

Call **run_skill** with **skill: "speech"**. Set **command** or **arguments.action** to the operation.

## Commands

- **transcribe** — Voice to text. **arguments.audio** (required): path to audio file (mp3, mp4, mpeg, mpga, m4a, wav, webm; max 25 MB). Optional: **arguments.model** (`whisper-1` or `gpt-4o-transcribe`), **arguments.language** (ISO code, e.g. `en`).
- **synthesize** — Text to voice. **arguments.text** (required): text to speak. **arguments.voiceId** (optional): 11Labs voice ID (default from config or a built-in). Optional: **arguments.outputPath** to save to a file.

## Arguments

- **transcribe**: `audio` (required), `model`, `language`
- **synthesize**: `text` (required), `voiceId`, `outputPath`

## When to use

- User sends a voice note or audio file and wants a transcript.
- User asks to "transcribe this", "what did they say", or "speech to text".
- User asks to "read this aloud", "turn this into speech", or "text to voice" — use synthesize with the text.

## Automatic voice on WhatsApp and Telegram

When the user sends a **voice message** (WhatsApp audio note or Telegram voice message), the bot automatically transcribes it with Whisper and feeds the text to the LLM. If speech is configured (Whisper + 11Labs), the **reply is sent back as voice** without the user having to ask. No extra prompt is needed: send a voice message and you get a voice reply.

## Config (set at install/setup)

Speech uses a **separate setup** from the LLM cloud provider:

- **Whisper (voice → text):** During setup you can choose to use your existing **OpenAI API key** (e.g. `LLM_1_API_KEY`) or enter a **separate Whisper/OpenAI key** (stored as `SPEECH_WHISPER_API_KEY`). Config: `skills.speech.whisper.apiKey` (env var name).
- **11Labs (text → voice):** During setup you are asked for your **11Labs API key**; it is stored in `.env` as `ELEVEN_LABS_API_KEY`. Config: `skills.speech.elevenLabs.apiKey` (env var name).

Re-run setup to add or change speech keys.
