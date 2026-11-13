---
kind: internal
---
The sign-in watch tests no longer depend on which test runs first: the stand-in engine now answers with its current state instead of counting reads, and each test waits for the watch itself.
