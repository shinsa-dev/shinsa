---
kind: internal
---
The relay socket test no longer fails on a slow machine: its stand-in channel now keeps a message sent before the relay listens and delivers it once it does, as the real channel does.
