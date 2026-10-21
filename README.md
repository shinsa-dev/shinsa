# Shinsa

審査: examination, judging.

A human-assisted coding harness. You state what you want; agents plan it, build it, check it and get the pull request clean. You only make the calls: approve the spec, review the change, approve the merge.

```sh
bun install
bun dev            # daemon on :5180, web app on :5181
```

Open http://localhost:5181, add a repository in Settings, and describe the first task.

Requires Bun, git, the GitHub CLI (`gh auth login`) and Claude Code (`claude`) signed in.
