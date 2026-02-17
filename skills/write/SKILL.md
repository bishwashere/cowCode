# Write

Creates or replaces a file **wholesale**. New file: done. Existing file: overwritten. Surgical swap.

Call **run_skill** with **skill: "write"**. Set **command** or **arguments.action** to **write**.

## Arguments

- **arguments.path** (required) — File path to create or overwrite. Relative to workspace or absolute (if allowed).
- **arguments.content** (required) — Exact content to write. Replaces the entire file.

## When to use

Use when the user says things like:
- "Write hello.txt with hi world"
- "Create config.json with …"
- "Save this to notes.md"
- "Overwrite .env with …"

One path, one content. No partial updates — use the **edit** skill for find-and-replace.
