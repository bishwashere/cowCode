# Cron

Manage reminders and scheduled messages: **one-shot** (at a specific time) or **recurring** (every morning, every 5 minutes, etc.). Call **run_skill** with **skill: "cron"**. The **command name** is the operation: use **command** or **arguments.action** set to exactly one of: **list**, **add**, **remove**.

**Reply channel:** By default the reminder reply is sent to the **same channel** (WhatsApp chat or Telegram chat) where the user set it up. This is stored with the job and used even when a separate cron process runs the task—no need to specify a channel; it stays attached to where it was created.

## Commands (name is command)

- **list** — Use when the user asks to list, see, or count reminders ("how many crons?", "list my reminders", "what's scheduled?"). Call once only. Do not also call add. No other fields needed.
- **add** — Only when the user explicitly asks to CREATE or SET a reminder. Set **arguments.job** with **message** (exactly what to remind) and **schedule**:
  - **One-shot:** `{ "kind": "at", "at": "<future ISO 8601>" }`. Always use an exact full ISO 8601 timestamp (e.g. 2026-02-19T08:00:00.000Z). Schedules are saved and run at that exact time. For "in 1 hour" or "tomorrow 8am" compute the exact datetime and pass it as ISO 8601.
  - **Recurring (cron):** `{ "kind": "cron", "expr": "<cron expression>", "tz": "optional IANA timezone" }`. Use the **expr** values below for common setups. Never invent message text.
- **remove** — When the user asks to cancel a reminder. Set **arguments.jobId** (from a previous list result).

You can pass the command at the top level (`command: "list"`) or inside arguments (`arguments.action: "list"`). Never omit the command/action.

## Recurring (cron) — every morning, every 5 minutes, etc.

Cron **expr** is 5 fields: **minute hour day-of-month month day-of-week** (space-separated). Use these for natural-language requests:

| User says | **expr** | Meaning |
|-----------|----------|---------|
| every 5 minutes | `*/5 * * * *` | Every 5 minutes |
| every minute | `* * * * *` | Every minute |
| every hour | `0 * * * *` | At minute 0 of every hour |
| every morning / every day at 8am | `0 8 * * *` | 8:00 daily |
| every day at 9am | `0 9 * * *` | 9:00 daily |
| every Monday at 8am | `0 8 * * 1` | 8:00 on Mondays (1 = Monday, 0 = Sunday) |
| every weekday at 8am | `0 8 * * 1-5` | 8:00 Mon–Fri |

Optional **tz** for timezone (e.g. `"America/New_York"`). Example job for "every morning at 8": `{ "message": "Good morning reminder", "schedule": { "kind": "cron", "expr": "0 8 * * *", "tz": "America/New_York" } }`.

## Notes

- For multiple new reminders in one message, call run_skill(cron, add) once per reminder with different job.message and job.schedule.
- For "every one minute for the next three minutes" use three one-shot **at** times. For "every 5 minutes" or "every morning" use **cron** with the **expr** above.
