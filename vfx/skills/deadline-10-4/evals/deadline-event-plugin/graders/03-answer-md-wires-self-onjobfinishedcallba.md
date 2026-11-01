---
type: llm
focus: trace
weight: 1
---

answer.md wires self.OnJobFinishedCallback += self.OnJobFinished and deletes the callback in Cleanup()
