# Read

Grabs a file's contents and returns every line. Like **peeking without touching** — no edits, no side effects.

Call **run_skill** with **skill: "read"**. Set **command** or **arguments.action** to **read**.

## Arguments

- **arguments.path** (required) — File path to read. Can be relative to workspace (e.g. `surface/main.py`, `MEMORY.md`) or an absolute path the bot is allowed to read.
- **arguments.from** (optional) — Start at 1-based line number.
- **arguments.lines** (optional) — Max number of lines to return (default: all).

## When to use

Use when the user says things like:
- "Read surface main.py"
- "Show me the contents of config.json"
- "What's in MEMORY.md?"
- "Peek at index.js"

The skill returns the file content as text. No modifications are made.
