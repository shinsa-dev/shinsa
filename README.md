# Shinsa

審査: examination, judging.

A human-assisted coding harness. You state what you want; agents plan it, build it, check it and get the pull request clean. You only make the calls: review the change, approve the merge, answer a question (and approve the plan, when you switch that on).

```sh
bun install
bun dev            # daemon on :5180, web app on :5181
```

Open http://localhost:5181. A short setup chat asks which folders hold your repositories (Shinsa registers each
repository the first time it works in it). Then describe the first task.

Requires Bun, git, the GitHub CLI (`gh auth login`) and Claude Code (`claude`) signed in; Codex (`codex login`) is
optional. The rest is in `docs/` (start with `docs/spec.md`).
