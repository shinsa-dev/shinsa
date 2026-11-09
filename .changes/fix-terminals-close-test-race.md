---
kind: internal
---
The engine test that closes a task’s terminals now waits for the ended shell’s exit to be published before it counts snapshots, so a slow runner can no longer fail it.
