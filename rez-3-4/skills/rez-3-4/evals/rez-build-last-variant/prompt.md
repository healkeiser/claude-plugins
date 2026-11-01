---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our rez package 'pipeline_core' has 4 variants (python-3.9, 3.10, 3.11, 3.13). With rez 3.4, how do I rez-build and install only the last variant into a custom repo at /mnt/rez/staging without hardcoding its index? And what's the difference between -i and --prefix? Write the commands and explanation in answer.md, cite the docs.
