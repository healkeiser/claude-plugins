---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Write a Deadline 10.4 event plugin called NotifyOnFinish that POSTs a small JSON payload (job name, job id, user) to a webhook URL whenever a job finishes. The webhook URL must be configurable from Monitor (Configure Events). Give me every file it needs with its repository path, in answer.md.
