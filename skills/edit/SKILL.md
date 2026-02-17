# Edit

Surgical find-and-replace in a file. Scans for **exact** matches, changes only those, saves. **Fails if no match** — so you know the edit was applied.

Call **run_skill** with **skill: "edit"**. Set **command** or **arguments.action** to **edit**.

## Arguments

- **arguments.path** (required) — File to edit. Relative to workspace or absolute.
- **arguments.oldString** (required) — Exact string to find. Must match exactly (including spaces/newlines).
- **arguments.newString** (required) — String to replace it with. Use empty string to delete the match.

## When to use

Use when the user says things like:
- "In Auth.js replace password with token"
- "Change the API URL in config to https://…"
- "Fix the typo 'teh' to 'the' in readme"

Only exact matches are replaced. If **oldString** does not appear in the file, the skill returns an error and the file is unchanged.
