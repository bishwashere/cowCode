# gog

Use `gog` for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
Requires OAuth setup.

Call `run_skill` with `skill: "gog"` and `arguments` as below.

Always set `arguments.action` to exactly `"run"`.
Never omit `action`.

---

## arguments shape

- action: "run"  
  Run a `gog` command.

- argv (required)  
  Array of strings for the `gog` command.  
  Do NOT include the `gog` prefix.

  Example:
  ["gmail","search","newer_than:7d","--max","10","--json","--no-input"]

- account (optional)  
  Email account for this call (sets `GOG_ACCOUNT`).

- confirm (required for sending mail or creating calendar events)  
  Must be true when using:
  - gmail send
  - calendar create
  - calendar add
  - calendar insert

---

## Setup (once)

gog auth credentials /path/to/client_secret.json  
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,sheets,docs  
gog auth list  

---

## Common commands

Gmail search  
gog gmail search "newer_than:7d" --max 10 --json --no-input  

Gmail send  
gog gmail send --to a@b.com --subject "Hi" --body "Hello" --json --no-input  

Calendar events  
gog calendar events <calendarId> --from <iso> --to <iso> --json --no-input  

Drive search  
gog drive search "query" --max 10 --json --no-input  

Contacts list  
gog contacts list --max 20 --json --no-input  

Sheets get  
gog sheets get <sheetId> "Tab!A1:D10" --json --no-input  

Sheets update  
gog sheets update <sheetId> "Tab!A1:B2" --values-json '[["A","B"],["1","2"]]' --input USER_ENTERED --json --no-input  

Sheets append  
gog sheets append <sheetId> "Tab!A:C" --values-json '[["x","y","z"]]' --insert INSERT_ROWS --json --no-input  

Sheets clear  
gog sheets clear <sheetId> "Tab!A2:Z" --json --no-input  

Sheets metadata  
gog sheets metadata <sheetId> --json --no-input  

Docs export  
gog docs export <docId> --format txt --out /tmp/doc.txt  

Docs cat  
gog docs cat <docId>  

---

## Result Size & Aggregation Policy

When performing Gmail searches that require counting, aggregation, or determining top senders:

- You may set `--max` to a high value (example: 2000 or 5000) to retrieve all relevant results within a time window.
- Best-effort full retrieval is acceptable.
- Do NOT block execution due to lack of pagination.
- If the number of returned results equals the `--max` value, warn that results may be truncated.
- Prefer `--json` and `--no-input` for machine-readable output.
- Count using the `From` header in returned results.

Do not assume pagination exists.
Do not refuse execution solely because pagination is unavailable.

---

## Execution Rules

- Always include `--json` when structured output is needed.
- Always include `--no-input` for automation.
- Never fabricate tool output.
- If a command fails, report the error.
- Do not simulate Gmail results.
- Only use the tool for real data retrieval.

---

## Notes

Set `GOG_ACCOUNT=you@gmail.com` to avoid repeating `--account`.  
Or set `skills.gog.account` in config.json to provide a default account.

Sheets values should be passed via `--values-json` when possible.

Docs supports export, cat, and copy.  
In-place edits require a Docs API client and are not supported in gog.

Always confirm before sending mail or creating events.