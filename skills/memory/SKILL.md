---
id: memory
name: Memory
description: Semantic search and save over notes (MEMORY.md, memory/*.md). Search log (chat history) is a built-in feature—call it only when the user explicitly mentions past conversations, yesterday, or logs. Tools: memory_search, memory_get, memory_save. See SKILL.md.
---

# Memory

Semantic search over your **notes** (`MEMORY.md`, `memory/*.md`) and optional **search log** (chat history). Use memory_search for notes whenever relevant.

**Search log (built-in)** — Chat is stored in `workspace/chat-log/YYYY-MM-DD.jsonl` and can be searched. **Only use memory_search to search chat history when the user explicitly asks**, e.g. "what did we talk about yesterday?", "search my logs", "last time we chatted", "what did I ask you before?", "our previous conversation". Do not search logs for general queries; only when the user clearly mentions past conversations, yesterday, or logs.

**Auto-indexing** — Notes (MEMORY.md, memory/*.md) and chat-log files are synced when you run memory_search. No manual "moo index" needed.

## Tools (pass `tool` in arguments: "memory_search", "memory_get", or "memory_save")

- **memory_search** — Set `tool: "memory_search"`, `query` (required). Optional: `maxResults`, `minScore`, `date`. Searches notes; if the user explicitly asked about past chats/yesterday/logs, the same search also includes chat history (`chat-log/YYYY-MM-DD.jsonl`). When the user asks about "yesterday", the search automatically includes that day's chat-log even if the word does not appear in the conversation. Optional `date: "yesterday"` can be set when the user asks about yesterday. Returns snippets with path and line range (paths may be `MEMORY.md`, `memory/2025-02-15.md`, or `chat-log/2025-02-16.jsonl`). Only search chat when the user explicitly mentions it.
- **memory_get** — Set `tool: "memory_get"`, `path` (required, from memory_search). Optional: `from`, `lines`. Read a snippet by path (including chat-log/*.jsonl when the user explicitly asked about past conversations).
- **memory_save** — Set `tool: "memory_save"`, `text` (required): the note to save. Optional: `file` (default: `MEMORY.md`; use `memory/notes.md` or any `.md` path inside the workspace). Appends the note with today's date prefix and immediately re-indexes so it is searchable at once. Use when the user says "remember that…", "note this down", "save this for later", "add to my notes", etc.

## Config

- Add `"memory"` to `skills.enabled`. Embedding: if an OpenAI key is available (e.g. `OPENAI_API_KEY` or an OpenAI model in LLM config), OpenAI is used; otherwise local (Ollama, `nomic-embed-text`) is used. You can override with `memory.embedding` in config.
- Workspace: `~/.cowcode/workspace/`. Create `MEMORY.md` and optionally `memory/*.md`. Chat logs live in `workspace/chat-log/` and are created automatically.
