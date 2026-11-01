---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I need a nightly audit of what changed on our Kitsu server. Write a Python script, using plain requests rather than gazu, that pulls every event about tasks from the last 24 hours for one production through the Zou REST API, going through all pages of results, and prints name, date and author of each. Tell me which endpoint and query parameters you used, what the maximum page size is, and what role the account running it needs. Put the script in audit_events.py and the explanation in answer.md, citing your sources.
