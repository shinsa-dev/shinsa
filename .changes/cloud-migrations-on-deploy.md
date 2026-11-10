---
kind: internal
---
Every deploy of the cloud Worker from `main` now applies the pending D1 migrations first, so a schema change no longer needs a migration run by hand.
