---
id: go-write
name: Go write
description: Change the filesystem: copy, move, delete, create files and directories, chmod. Commands: cp, mv, rm, touch, chmod, mkdir. Enable in config (skills.enabled).
---

# Go write

Filesystem-changing commands. Enable **go-write** in configuration (`skills.enabled`) to copy, move, delete, create files and directories, or change permissions.

Call `run_skill` with **skill: "go-write"**. Set **command** or **arguments.action** to the command name. Set **arguments.argv** to an array of arguments.

## Commands (allowlist)

- **cp** — Copy. argv: `["source", "dest"]` or `["-r", "source", "dest"]`. **Recursive directory copies** (e.g. a whole project folder) use `rsync` under the hood and **omit** dependency trees and common caches by default: `node_modules`, `.git`, virtualenvs, `.next` / `dist` / `build` / `target`, IDE/build tool dirs, etc. **Do not** copy those unless the user clearly asks for a complete mirror. When they want **everything** (including `node_modules`, `.git`, caches), set **`fullCopy: true`** on the tool arguments, or put **`--cowcode-full-copy`** as the **first** entry in `argv` (then the usual flags and paths follow).
- **mv** — Move/rename. argv: `["source", "dest"]`
- **rm** — Remove. argv: `["path"]` or `["-r", "path"]`
- **touch** — Create empty file or update mtime. argv: `["path"]`
- **chmod** — Change mode. argv: e.g. `["755", "file"]` or `["+x", "file"]`
- **mkdir** — Create directory. argv: `["path"]` or `["-p", "a/b/c"]`

## Arguments

- **arguments.command** or **arguments.action** (required) — One of: cp, mv, rm, touch, chmod, mkdir
- **arguments.argv** (required) — Array of strings (flags and paths). Do not include the command name.
- **arguments.cwd** (optional) — Working directory. Defaults to workspace.
- **arguments.fullCopy** (optional) — For **`cp`** of a directory with `-r` / `-a`: if true, copy the full tree (no default excludes). Same as leading **`--cowcode-full-copy`** in `argv`.

## When to use

Use when the user asks to copy, move, delete, or create files or directories, or change permissions. Do not use for listing, disk usage, or reading—use **go-read** for that.

## Tool schema

```tool-schema
go_write_run
  description: Run a filesystem-changing command. command: cp, mv, rm, touch, chmod, or mkdir. argv: array of args.
  parameters:
    command: string
    argv: array
    cwd: string
```
