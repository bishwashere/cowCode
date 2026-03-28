---
id: ssh-inspect
name: SSH inspect
description: Read-only inspection of a remote Linux/Unix host over SSH. Commands: df, du, ls, pwd, cat, stat, find. Use when the user names a remote host, server, or machine and asks about disk space, folder sizes, directory layout, largest folders, or file contents. Requires ssh-inspect in skills.enabled and SSH key access to the host.
---

# SSH inspect

Run **read-only** commands on a remote host from the cowCode machine via `ssh`. The executor spawns the local `ssh` binary; commands execute **on the remote** and output returns here. No writes, no package installs, no interactive shell.

## How to call

`run_skill` with **skill: `"ssh-inspect"`** and structured arguments below.

## Arguments

- **host** (required) — Hostname, IP, or alias from `~/.ssh/config` (e.g. `"db1"`, `"10.0.0.5"`).
- **user** (optional) — Remote user. Defaults to `SSH_INSPECT_USER` env var, or the system SSH default.
- **command** (required) — One of the allowlisted names below.
- **argv** (required) — Array of flags and paths for that remote command only.

## Allowlisted remote commands

| User intent | command | argv examples |
|---|---|---|
| Disk free / filesystem usage | `df` | `["-h"]`, `["-h", "/"]` |
| Folder / tree disk usage | `du` | `["-sh", "/var/log"]`, `["-xh", "--max-depth=1", "/"]` |
| List directory | `ls` | `["-la", "/path"]` |
| Print working dir | `pwd` | `[]` |
| Show file contents | `cat` | `["/path/to/file"]` |
| File/dir metadata | `stat` | `["/path"]` |
| Find files (read-only) | `find` | `["/var", "-name", "*.log", "-maxdepth", "3"]` |

**Never request:** `rm`, `dd`, `mkfs`, `chmod`, `sudo`, arbitrary `bash -c` with user-controlled strings, or any write/destructive operations.

## Examples

Disk usage on `db1`:

`run_skill` with skill: `"ssh-inspect"`, arguments: `{ "host": "db1", "command": "df", "argv": ["-h"] }`

Top folders using disk on `/`:

`run_skill` with skill: `"ssh-inspect"`, arguments: `{ "host": "db1", "user": "ubuntu", "command": "du", "argv": ["-xh", "--max-depth=1", "/"] }`

List `/var/log`:

`run_skill` with skill: `"ssh-inspect"`, arguments: `{ "host": "db1", "command": "ls", "argv": ["-la", "/var/log"] }`

## Configuration

**This skill is not enabled by default** and must be explicitly enabled — it is never active in group chats.
To enable it, either:
- Add `"ssh-inspect"` to `skills.enabled` in your dashboard (Skills tab), or
- Run `cowcode skills install ssh-inspect` from the terminal, or
- Manually add `"ssh-inspect"` to `skills.enabled` in `~/.cowcode/config.json` and restart.

Set up SSH key-based auth to the remote host (`ssh-copy-id` or `authorized_keys`).
Optionally set `SSH_INSPECT_USER=ubuntu` in `~/.cowcode/.env` as a default remote user.
Optionally set `SSH_INSPECT_IDENTITY=/path/to/key` in `~/.cowcode/.env` to use a specific private key.
Optionally set `SSH_INSPECT_TIMEOUT=30` in `~/.cowcode/.env` to change the timeout in seconds.

## Server registry

Register named servers so you can say "check disk on prod" instead of typing an IP each time.
Entries are stored in `~/.cowcode/config.json` under `skills["ssh-inspect"].hosts`.

**Register a server:**
```
cowcode server add 203.0.113.5 prod
cowcode server add 203.0.113.5 staging --user ubuntu
```
`host` and `name` are required. User defaults to `root`; override with `--user`.

**List registered servers:**
```
cowcode server list
```

**Remove a server:**
```
cowcode server remove staging
```

Once registered, you can refer to servers by name in conversation:
- "How much disk is left on prod?"
- "List /var/log on staging"

The executor resolves the name → hostname (and user/key) from the registry before connecting.
If the name is not in the registry, it is used directly as a hostname/IP (passthrough).

## Tool schema

```tool-schema
ssh_inspect_run
  description: Run one read-only command on a remote host via SSH. command must be df, du, ls, pwd, cat, stat, or find. argv contains only the flags and paths for that command.
  parameters:
    host: string
    user: string (optional)
    command: string
    argv: array
```
