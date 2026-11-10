---
kind: fixed
---
A watchdog now follows whether the change is live. A check that finds it is not in production, or was rolled back, moves it to Waiting for production, and it starts a fresh window once the change is live again.
