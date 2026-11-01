---
type: llm
focus: trace
weight: 1
---

The callback reads data["task_id"] and fetches the task (for example gazu.task.get_task) to get the entity, task type and status, since the event carries only the task id
