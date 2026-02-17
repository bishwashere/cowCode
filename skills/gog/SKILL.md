---
name: gog
description: Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
homepage: https://gogcli.sh
metadata: {"clawdbot":{"emoji":"gamepad","requires":{"bins":["gog"]},"install":[{"id":"brew","kind":"brew","formula":"steipete/tap/gogcli","bins":["gog"],"label":"Install gog (brew)"}]}}
---

# gog

Use `gog` for Gmail/Calendar/Drive/Contacts/Sheets/Docs. Requires OAuth setup.

Call `run_skill` with `skill: "gog"` and `arguments` as below.

**Always set arguments.action to exactly "run". Never omit action.**

## arguments shape

- **action: "run"** — Run a `gog` command.
- **argv** (required) — Array of strings for the `gog` command (do not include the `gog` prefix). Example: `["gmail","search","newer_than:7d","--max","10","--json","--no-input"]`.
- **account** (optional) — Email account for this call (sets `GOG_ACCOUNT`).
- **confirm** (required for sending mail or creating calendar events) — Must be `true` when using `gmail send` or calendar create/add/insert actions.

## Setup (once)

- `gog auth credentials /path/to/client_secret.json`
- `gog auth add you@gmail.com --services gmail,calendar,drive,contacts,sheets,docs`
- `gog auth list`

## Common commands (examples)

- Gmail search: `gog gmail search "newer_than:7d" --max 10 --json --no-input`
- Gmail send: `gog gmail send --to a@b.com --subject "Hi" --body "Hello" --json --no-input`
- Calendar: `gog calendar events <calendarId> --from <iso> --to <iso> --json --no-input`
- Drive search: `gog drive search "query" --max 10 --json --no-input`
- Contacts: `gog contacts list --max 20 --json --no-input`
- Sheets get: `gog sheets get <sheetId> "Tab!A1:D10" --json --no-input`
- Sheets update: `gog sheets update <sheetId> "Tab!A1:B2" --values-json '[["A","B"],["1","2"]]' --input USER_ENTERED --json --no-input`
- Sheets append: `gog sheets append <sheetId> "Tab!A:C" --values-json '[["x","y","z"]]' --insert INSERT_ROWS --json --no-input`
- Sheets clear: `gog sheets clear <sheetId> "Tab!A2:Z" --json --no-input`
- Sheets metadata: `gog sheets metadata <sheetId> --json --no-input`
- Docs export: `gog docs export <docId> --format txt --out /tmp/doc.txt`
- Docs cat: `gog docs cat <docId>`

## Notes

- Set `GOG_ACCOUNT=you@gmail.com` to avoid repeating `--account`.
- Or set `skills.gog.account` in config.json to provide a default account.
- For scripting, prefer `--json` plus `--no-input`.
- Sheets values can be passed via `--values-json` (recommended) or as inline rows.
- Docs supports export/cat/copy. In-place edits require a Docs API client (not in gog).
- Confirm before sending mail or creating events.
