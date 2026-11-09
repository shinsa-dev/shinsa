---
kind: internal
---
The lint now refuses new throws, try/catch, JSON.parse, timers and null returns outside Effect, and keeps the existing ones in a baseline that can only shrink.
