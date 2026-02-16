# Cron

Manage reminders and scheduled messages.

## Actions

- **list** — Use for any query about existing jobs: "how many crons?", "which crons are set?", "list my reminders", "what's scheduled?". Call only list (once). Do NOT also call add.
- **add** — Only when the user explicitly asks to CREATE/SET a new reminder. Requires `job` with `message` and `schedule`. For "in 5 minutes" or "tomorrow 8am" use `schedule.kind` "at" with "at" as future ISO 8601. For recurring use kind "cron" with "expr" (e.g. "0 8 * * *") and optional "tz".
- **remove** — Delete a job. Requires `jobId` from list.

## Notes

- When the user asks for multiple new reminders, call add twice with different message and at.
- For "every one minute for the next three minutes" call add THREE times.
- Never invent reminder text: `job.message` must be exactly what the user asked to receive.
