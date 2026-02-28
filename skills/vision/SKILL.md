---
id: vision
name: Vision
description: Describe or analyze an image using a vision-capable model. Use arguments.image, arguments.url, or arguments.path for the image (file path from "Image file: ..." in message, URL, or "webcam"). Live camera: image "webcam" or source "webcam". See SKILL.md.
---

# Vision

Read or analyze an image using a **vision-capable LLM**. Use when the user sends an image, when you have an image path (e.g. from a browse screenshot), or when the user wants to **see through the camera** ("Show me what you see" → describes the room).

**Built-in chaining:** Screenshot → auto-describe → act. After a browse **screenshot**, use the returned file path with vision to describe the page; then you can **click**, **fill**, or **scroll** in a follow-up step. The user does not need to say "describe this then click"—you chain screenshot → vision → browse actions as needed.

**Live camera:** Vision can use the **webcam** as input, not just files. Set **arguments.image** to **"webcam"** (or **arguments.source** to **"webcam"**) to capture one frame from the default camera. Use for prompts like "Show me what you see", "What's in the room?", "Describe what's in front of the camera."

Call **run_skill** with **skill: "vision"**. Set **command** or **arguments.action** to **describe**. Arguments:

- **arguments.image**, **arguments.url**, or **arguments.path** — **Required** (unless **arguments.source** is **"webcam"**). Pass the image as one of these (all work the same): **image**, **url**, or **path**. Value can be:
  - **"webcam"** — Capture one frame from the default webcam (live camera). Use for "what do you see", "describe the room", etc.
  - A **file path** (e.g. when the message says "Image file: /path/to/file.jpg", use that path as **arguments.image** or **arguments.path**; or browse screenshot under `~/.cowcode/browse-screenshots/`, or user upload under uploads), or
  - An **image URL** (http/https), or
  - A **data URI** (data:image/...;base64,...).
- **arguments.source** — Optional. Set to **"webcam"** to use the live camera instead of **arguments.image**.
- **arguments.prompt** — Optional. What to ask about the image (e.g. "What's in this image?", "Read any text visible.", "Describe the room."). Default: describe what you see and read any text.
- **arguments.systemPrompt** — Optional. Override the default system instruction for the vision model.

## When to use Vision

- **User sent an image in chat** — The message will include a file path where the image was saved (e.g. "Image file: /path/to/tg-123-78.jpg"). Call vision with **arguments.image** or **arguments.path** set to that path, and **arguments.prompt** to the user's caption (or "What's in this image?").
- **"Show me what you see" / "What's in the room?"** — Use **arguments.image: "webcam"** (or **arguments.source: "webcam"**) to capture from the webcam and describe the scene.
- **After a browse screenshot** — Screenshot details include a path under `~/.cowcode/browse-screenshots/`. Use vision with that path to describe or analyze the page; then chain with click/fill/scroll as needed. No need for the user to say "describe this then click."
- **Any image URL** — Pass the URL as **arguments.image** or **arguments.url** to have the vision model describe it.

You must provide an image source: **arguments.image**, **arguments.url**, or **arguments.path** (file path from "Image file: ..." in the message), or **arguments.source: "webcam"**.

## Config (set at install/setup)

- **If your agent model already supports vision** (e.g. GPT-4o, Claude-3): the image is sent to that model with the same API key; no extra key or switch.
- **If your agent is on a text-only model** (e.g. LM Studio local, GPT-3.5, Llama): during setup you can choose a **vision fallback** (OpenAI or Anthropic). When the user sends an image, the agent tries the main models first; if they don’t support vision, it quietly uses the fallback for that call only. Configure once at setup; no mid-run prompts. In config: `skills.vision.fallback` with `provider`, `model`, and `apiKey` (env var name, e.g. `LLM_1_API_KEY`). Same style as `llm.models` and versions chosen in setup.
