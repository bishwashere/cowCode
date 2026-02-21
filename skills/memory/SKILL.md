# Memory

Semantic search over your **notes** (`MEMORY.md`, `memory/*.md`) and **chat history** (every conversation is automatically indexed). "Remember what we said yesterday?" pulls from logs—no manual step.

**Chat history baked in** — Not just files. Conversations are stored in `workspace/chat-log/YYYY-MM-DD.jsonl` and embedded so memory_search finds them. Use memory_search for queries like "what did we decide about X?", "what did I ask yesterday?", "remember when we talked about Y?"

**Auto-indexing** — Every message you send gets embedded and added to the index. No manual "moo index" or sync needed. File-based notes (MEMORY.md, memory/*.md) are synced when you run memory_search or on watch; chat is indexed as you talk.

## Tools (pass `tool` in arguments: "memory_search", "memory_get", or "memory_save")

- **memory_search** — Set `tool: "memory_search"`, `query` (required). Optional: `maxResults`, `minScore`. Semantically search notes and chat history. Returns snippets with path and line range (paths may be `MEMORY.md`, `memory/2025-02-15.md`, or `chat-log/2025-02-16.jsonl`).
- **memory_get** — Set `tool: "memory_get"`, `path` (required, from memory_search). Optional: `from`, `lines`. Read a snippet by path (including chat-log/*.jsonl for past conversations).
- **memory_save** — Set `tool: "memory_save"`, `text` (required): the note to save. Optional: `file` (default: `MEMORY.md`; use `memory/notes.md` or any `.md` path inside the workspace). Appends the note with today's date prefix and immediately re-indexes so it is searchable at once. Use when the user says "remember that…", "note this down", "save this for later", "add to my notes", etc.

## Config

- Add `"memory"` to `skills.enabled`. Embedding: if an OpenAI key is available (e.g. `OPENAI_API_KEY` or an OpenAI model in LLM config), OpenAI is used; otherwise local (Ollama, `nomic-embed-text`) is used. You can override with `memory.embedding` in config.
- Workspace: `~/.cowcode/workspace/`. Create `MEMORY.md` and optionally `memory/*.md`. Chat logs live in `workspace/chat-log/` and are created automatically.
