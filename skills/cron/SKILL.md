# Cron

Manage reminders and scheduled messages. Call **run_skill** with **skill: "cron"**. The **command name** is the operation: use **command** or **arguments.action** set to exactly one of: **list**, **add**, **remove**.

## Commands (name is command)

- **list** — Use when the user asks to list, see, or count reminders ("how many crons?", "list my reminders", "what's scheduled?"). Call once only. Do not also call add. No other fields needed.
- **add** — Only when the user explicitly asks to CREATE or SET a reminder. Set **arguments.job** with **message** (exactly what to remind) and **schedule**: for one-shot use `{ "kind": "at", "at": "<future ISO 8601>" }`, for recurring use `{ "kind": "cron", "expr": "0 8 * * *", "tz": "optional" }`. Never invent message text.
- **remove** — When the user asks to cancel a reminder. Set **arguments.jobId** (from a previous list result).

You can pass the command at the top level (`command: "list"`) or inside arguments (`arguments.action: "list"`). Never omit the command/action.

## Notes

- For multiple new reminders in one message, call run_skill(cron, add) once per reminder with different job.message and job.schedule.at.
- For "every one minute for the next three minutes" call add three times with three different "at" times.
