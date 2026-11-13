---
kind: internal
---
A preview that answers 503 because its machine stopped sending heartbeats, or because its service is not running, now writes a warn line saying why, so the error watch can set it apart from a real failure.
