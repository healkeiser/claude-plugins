---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I want a small always-on Python service that reacts whenever a task's status changes in Kitsu and prints the task's entity name, task type and new status. It must not run under a real person's account. Explain how to get the credentials it should use, then write the service with gazu in task_watcher.py. Our Kitsu is at https://kitsu.example.com. Put the explanation in answer.md and cite your sources.
