---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Write me a Python script build_forest.py using the pxr API that creates forest.usda with 5000 tree prims under /World/Forest, each referencing ./tree.usda, marked instanceable, with a random translate. It has to be fast, we'll run it on much bigger counts later, so use whatever the fastest authoring approach in USD is. Explain the choice briefly in a comment at the top.
