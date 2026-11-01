---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We're on rez 3.4. I want a package.py for 'mytool' 2.1.0 whose requires gets an extra 'debugpy' dependency only when the resolve contains the ephemeral '.debug-1'. Can a @late function see ephemerals? Write the package.py. Also, rez-env takes forever to start a shell on some workstations; what built-in setting helps me see what happens during shell startup? Put everything in answer.md and cite the docs.
