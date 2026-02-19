# Core commands

Built-in shell commands. **Always available** — no need to enable in config.

Call `run_skill` with **skill: "core"**. Set **command** or **arguments.action** to the command name. Set **arguments.argv** to an array of arguments (e.g. paths, flags).

## Commands (allowlist)

- **ls** — List directory contents. argv: e.g. `["-la"]`, `["-la", "/path"]`
- **cd** — Change directory and output the new path. argv: `["/path"]`. Returns the resolved path.
- **pwd** — Print working directory. argv: `[]`
- **cat** — Output file contents. argv: `["/path/to/file"]`
- **less** — View file (non-interactive, one screen). argv: `["/path/to/file"]` or with flags
- **cp** — Copy. argv: `["source", "dest"]` or `["-r", "source", "dest"]`
- **mv** — Move/rename. argv: `["source", "dest"]`
- **rm** — Remove. argv: `["path"]` or `["-r", "path"]`
- **touch** — Create empty file or update mtime. argv: `["path"]`
- **chmod** — Change mode. argv: e.g. `["755", "file"]` or `["+x", "file"]`

## Arguments

- **arguments.command** or **arguments.action** (required) — One of: ls, cd, pwd, cat, less, cp, mv, rm, touch, chmod
- **arguments.argv** (required) — Array of strings (flags and paths). Do not include the command name.
- **arguments.cwd** (optional) — Working directory for the command. Defaults to workspace.

## When to use

Use when the user asks to list a directory, read a file (cat/less), copy/move/delete files, create a file (touch), or change permissions (chmod). Prefer **read** skill for reading file contents with line ranges; use **core** cat/less when the user says "cat", "show file", or "list directory" (ls).

## Example

List workspace:
`run_skill` with skill: "core", arguments: { command: "ls", argv: ["-la"] }

Read a file:
arguments: { command: "cat", argv: ["~/.cowcode/config.json"] }
