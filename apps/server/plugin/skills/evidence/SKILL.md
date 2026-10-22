---
name: evidence
description: How to prove user-facing work before handing it over in Shinsa — screenshots and recordings for web UI, simulator captures for iOS, failing-then-passing tests for logic. Use whenever your change is visible to a user.
---

# Evidence

The human reviews the evidence before the diff. Without it they have to run your change themselves, which is the work Shinsa exists to save. Attach every piece with `attach_evidence`.

## Web UI

1. Start the app the way the repository says (its CLAUDE.md, README, package scripts). Use a free port.
2. Drive the changed flow with Playwright (the browser MCP tools if you have them, otherwise a short Playwright script with `bunx playwright`).
3. Capture, for every screen you changed:
   - light and dark mode,
   - tablet width (about 820px) and phone width (about 390px),
   - every state that changed: empty, loading, error, filled.
4. For interactions, record a short video (Playwright `recordVideo`) of the flow from start to finish.
5. Read the browser console. An error you introduced is a bug, not evidence.
6. Attach each file with `attach_evidence` (`kind: "screenshot"` or `"recording"`, absolute `path`, a title that says what it shows).

## iOS

Build for a simulator with `xcodebuild`, install it with `xcrun simctl install`, launch it, capture with `xcrun simctl io <device> screenshot` and `recordVideo`. Same states as web.

## Logic

Write the test that fails without your change and passes with it. Attach the run output with `kind: "test"` and `text`.

## When you cannot

If the app cannot run here (missing secrets, services), say so plainly in your summary and attach what you could: a test, a type check, a storybook render. Never claim something works that you did not see work.
