---
kind: improved
---

A task whose step fails now retries on its own after 1, 5, 15 and 30 minutes, then hourly, and shows Retrying with the reason. It stops and asks you only after 10 retries without progress.
