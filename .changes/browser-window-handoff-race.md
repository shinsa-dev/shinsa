---
kind: internal
---
Open sign-in window now waits for Chrome to hand the new window to the one already running, so closing it right after can no longer leave a stray window on the profile. This also fixes a flaky browser host test.
