---
kind: internal
---

The release job that copies downloads and updates to shinsa.dev now retries each request to R2 and GitHub, so a temporary storage error no longer fails a release.
