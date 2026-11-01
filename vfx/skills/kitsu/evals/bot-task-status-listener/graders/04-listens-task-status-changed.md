---
type: llm
focus: trace
weight: 1
---

task_watcher.py uses gazu.events.init(), gazu.events.add_listener(client, "task:status-changed", callback) and gazu.events.run_client(client)
