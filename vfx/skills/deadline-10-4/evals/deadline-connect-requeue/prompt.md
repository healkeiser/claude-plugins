---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Standalone Python script (outside Deadline, talking to our Deadline 10.4 web service on 'farmweb01'): find every Failed job in pool 'houdini', print name and id, then resume the failed tasks of each. Write requeue_failed.py and note any setup it needs.
