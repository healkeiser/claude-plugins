---
type: llm
focus: trace
weight: 1
---

audit_events.py pages through results with the limit query parameter and cursor_event_id set to the id of the last event of the previous page, and does not rely on a page_size or page parameter
