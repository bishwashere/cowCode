---
id: go-write
name: Go write
description: Change the filesystem: copy, move, delete, create files, chmod. Commands: cp, mv, rm, touch, chmod. Enable in config (skills.enabled).
---

# Go write

Filesystem-changing commands. Enable **go-write** in configuration (`skills.enabled`) to copy, move, delete, create files, or change permissions.

Call `run_skill` with **skill: "go-write"**. Set **command** or **arguments.action** to the command name. Set **arguments.argv** to an array of arguments.

## Commands (allowlist)

- **cp** — Copy. argv: `["source", "dest"]` or `["-r", "source", "dest"]`
- **mv** — Move/rename. argv: `["source", "dest"]`
- **rm** — Remove. argv: `["path"]` or `["-r", "path"]`
- **touch** — Create empty file or update mtime. argv: `["path"]`
- **chmod** — Change mode. argv: e.g. `["755", "file"]` or `["+x", "file"]`

## Arguments

- **arguments.command** or **arguments.action** (required) — One of: cp, mv, rm, touch, chmod
- **arguments.argv** (required) — Array of strings (flags and paths). Do not include the command name.
- **arguments.cwd** (optional) — Working directory. Defaults to workspace.

## When to use

Use when the user asks to copy, move, delete, or create files, or change permissions. Do not use for listing or reading—use **go-read** for that.

## Tool schema

```tool-schema
go_write_run
  description: Run a filesystem-changing command. command: cp, mv, rm, touch, or chmod. argv: array of args.
  parameters:
    command: string
    argv: array
    cwd: string
```
