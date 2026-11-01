---
type: llm
focus: trace
weight: 1
---

task_watcher.py calls gazu.set_host with the URL ending in /api and gazu.set_event_host with the server URL without /api
