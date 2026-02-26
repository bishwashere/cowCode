---
id: me
name: Me
description: Build a profile of what CowCode knows about the user from MEMORY.md, memory/*.md, and recent chat logs. Use when the user asks "what do you know about me?", "what have you learned about me?", "summarize what you know about me", or similar.
---

# Me

Builds a **profile** of what CowCode knows about the user and presents it in a human-friendly format.

## When to use

Call **run_skill** with **skill: "me"** when the user asks things like:

- "What do you know about me?"
- "What have you learned about me?"
- "Summarize what you know about me"
- "Tell me about myself"
- "What's in your memory about me?"
- "What do you remember about me?"

No arguments are required. The skill reads **MEMORY.md**, **memory/*.md**, and **recent chat logs** (today, yesterday, and the last few days), then returns a concise, human-readable profile.

## What it does

- Reads your notes: **MEMORY.md** and any **memory/*.md** in the workspace.
- Reads **chat logs** from the last several days (date-based and, when available, this chat’s private log).
- Combines them into a short profile (notes, recent topics, and any explicit facts) so you can see what CowCode knows about you at a glance.

## How to present the result

**Always reply in natural language only.** Do not use numbered sections (e.g. "1) Basics"), bullet points, or lists. Turn the profile into a few short, conversational sentences (e.g. "I know your name is Bishwas. You mentioned it snowed on 2026-02-23. We've been talking about thermostat and Home Assistant lately, and you have a few active reminders."). Keep it friendly and flowing, not structured or list-like.

Use this whenever the user wants to see their profile or what the system knows about them.
