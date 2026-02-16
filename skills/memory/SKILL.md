# Memory

Semantic search and read over your notes in `MEMORY.md` and `memory/*.md` (e.g. `memory/2025-02-15.md`).

## Tools

- **memory_search** — Semantically search for prior work, decisions, preferences, or todos. Returns snippets with path and line range. Use before answering questions about past context.
- **memory_get** — Read a snippet by path (from memory_search) and optional line range. Use after memory_search to pull only needed lines.

## Config

- Add `"memory"` to `skills.enabled`. Set an embedding API key (e.g. OpenAI) in .env; if omitted, the first LLM model's key is used.
- Workspace: `~/.cowcode/workspace/`. Create `MEMORY.md` and optionally `memory/*.md`.
