# Skill format (compact-compatible)

One central agent handles everything: it picks the right skill from the list, runs it in the shared executor, and keeps things smooth. Skills add smarts like shortcuts or recipes; the heavy lifting stays shared. No babysitters, no extras.

Every skill must be **compact-compatible** so the loader can inject a short list (name + description) on each run and full doc when the skill is called.

## Required frontmatter

In each skill's `SKILL.md`, use YAML frontmatter between the first `---` and second `---`:

- **`id`** (optional) — Skill id used in `run_skill` (defaults to folder name). Must match the skill folder name (e.g. `cron`, `search`, `memory`).
- **`description`** (required) — One-line summary for the compact list. Keep it under ~280 characters. Used when the loader builds the compact list; the model sees this before choosing a skill.
- **`name`** (optional) — Human-readable label (e.g. "Cron", "Apply patch"). Used for display; the compact list still shows `id` so the model passes the correct value to `run_skill`.

## Example

```markdown
---
id: cron
name: Cron
description: Manage reminders and scheduled messages. Actions: list, add, remove. See skill.md for arguments.
---

# Cron
...
```

## Parser behavior

- **Compact list:** The loader extracts `description` (and optionally `name`) and builds one line per skill: `- **id**: description`.
- **Fallback:** If `description` is missing, the first line of the body (after frontmatter) or the skill id is used.
- **Full doc:** When the model calls `run_skill(skill: "cron", ...)`, the full `SKILL.md` content is injected into the tool result for that turn.

Ensure every skill has at least `description:` in frontmatter so the compact request works consistently.
