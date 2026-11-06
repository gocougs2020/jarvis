---
name: remind
description: >
  Use when the user wants a time-bound reminder or follow-up —
  "remind me to…", "don't let me forget…", "let me know about…",
  "nudge me…", "remember to do X tomorrow", "make sure you… Friday",
  "follow up with me about…". Do not use for standing preferences
  with no clock ("remember I prefer aisle seats") — that is /memory.
  Load immediately when the user writes /remind or /reminder.
---

# Remind

Time-bound follow-through. Two modes. Both are one-off jobs (`cadence` once). Ask for a date and time before creating a job. Do not guess.

## Pick a mode

**Nudge** — the user is the actor. Ping them.

- "remind me", "let me know", "don't let me forget", "nudge me", "follow up with me"
- Anything they must do in the world (buy a battery, fold clothes, pick someone up)

**Do** — you are the actor. Finish the work at that time.

- "remember to draft…", "make sure you…", "tomorrow, send me the comparison"
- Work you can do with tools: write, research, update a file, draft an email, search inbox

If it is ambiguous, ask once: ping you, or should I do it? If you cannot do the task (physical work, a payment, someone else's job), it is a nudge even if they said "remember to".

## Create the job

1. If they did not give a date and time, ask. A day without a clock time still needs a time.
2. Follow this turn's host schedule-plan note. Hobby (the default) is at most once a day — do not use hourly or an interval under 24 hours.
3. Call `create_schedule`:
   - Nudge: omit `skill`. Brief is what to ping them about, in their words.
   - Do: pass `skill` `remind`. Brief is the work to finish — facts only, not this procedure.
   - Both: `cadence` `{ kind: "once", timezone, at }` and a matching `firstRunAt`.
4. Tell them when it will fire, that they will get an email from the agent address, and that a session will open they can continue.

## When this job fires (nudge)

The runtime already searched sessions and files with a tight embedding floor. If the dispatch prompt includes matched snippets, put only those in the email as optional context (title, one line, link). If it says nothing matched, do not search and do not invent related notes.

## When this job fires (do mode)

This section is for unattended `/remind` runs.

1. Restate the brief in one line.
2. In one step, search for prior work: `list_documents` (and `list_emails` if mail is likely). Use related-session snippets if they were provided. Read only matching files.
3. If the work is already done, write a short status in chat (what you found, with `[n]` citations if you used sessions). Do not redo it.
4. If it is not done, do the work now. Do not ask questions. Do not invent prices or live facts. Save a file only if the brief called for one.
5. Call `send_email`. Omit `to`. Subject like `Reminder: …` or `Done: …`. Body: short status plus the session link from the dispatch prompt. Do not email anyone else.

## Quick start

If the user invoked this skill with `/remind` and no extra brief, ask what to follow up on, when, and whether to ping them or for you to do the work. Then create the job.
