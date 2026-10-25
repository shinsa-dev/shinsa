# Shinsa: a real code editor and viewer on the task page

Research only, nothing edited in the repo. Paths are relative to `/Users/christo/Developer/Projects/shinsa`.

## Decision in one paragraph

Turn the Code tab into a small workbench: an explorer on the left (three modes: **Review**, **Changes**, **Files**),
a tab strip, and one editor area where every tab is a file or a diff. Build it on **CodeMirror 6** (read-only by
default, `@codemirror/merge` for diffs, `@codemirror/search` for find and go to line). Read every file from git
objects at a pinned commit, not from the worktree's working copy, so code stays viewable after the worktree is gone and
a review never shifts under you while an agent keeps typing. Search runs on the server with `git grep` (no extra
binary). Editing was first planned as suggested changes sent with Request changes; since 2026-10-25 you **edit
directly**: the file saves to the task's working copy as you type and goes into the round's next commit (below).

## Done since the plan

- **Line comments reach the agent whole.** `gate.answer` carries them as data (`comments`, `ReviewComment`: path,
  side, lines, words); core writes them into the agent's fix prompt (`docs/protocol.md` → Line comments).
- **Direct editing (2026-10-25), replacing suggested changes.** The editor at Head of the branch or the Working copy
  of an open task is editable with no mode; each pause saves through `POST /api/tasks/<id>/file` with the text it
  expects on disk (a 409 hands back the disk's text, merged with your unsaved edit when the lines differ), through
  each workspace strategy (`writeEdit`; GitButler records the path as the task's in its ledger). Core keeps
  `editedPaths` and `untoldEdits`: the agent is steered at once and told again in its next turn; approving the review
  with edits no hand-over took commits them and runs the checks again, and approving the merge with them pushes them
  and merges once CI passes (`docs/engine.md` → Your edits). Suggestions are gone
  everywhere (`ReviewComment.suggestion`, the web's Suggest a change and Add the suggestion, the prompt lines).
- **Side by side by default (2026-10-25).** Unified is the remembered toggle (`shinsa.code-unified`); each side
  scrolls under pinned line numbers; folds are no cursor stop (`lib/code/editor/collapsed.ts`); notes fit the side
  they sit in; Open in editor left the toolbar.
- **Big changes and VS Code keys (2026-10-25).** The diff answer is a summary with patches for small files only
  (`patchOmitted`; a named file is read whole with `path=`), the trees and search results are virtual lists, a
  search streams NDJSON and folds case into the pattern instead of `-i`, the editor is built after the tree paints
  and hidden until measured, a file over 1 MB or with a line over 10,000 characters waits behind Open anyway, and
  switching refs or modes measures zero layout shift and no task over 50ms on a 4,503-file paywall-next diff and a
  100,000-file synthetic repository. The editor has VS Code's editing keys from CodeMirror's commands
  (`lib/code/editor/commands.ts`), listed in ⌘K's Editor group, with find and replace and ⌘S. A save no longer
  rebuilds the editor (the cause of "the file locks after one edit": the read moved to the working copy and the
  pane unmounted the editor while it loaded).
- **One set of code colours.** Chat code fences, tool output and snippets run Shiki on a theme of TextMate scopes
  mapped to the `--code-*` tokens the CodeMirror editor reads (`lib/code/highlight.ts`); the GitHub themes and
  `.code-token` are gone.
- **`/ui` specimens for the editor** (`routes/ui/code.tsx`): the code tokens, a chat fence beside the editor, a diff
  side by side with its new side editable, the same diff unified with a finding and a comment inline, and Go to file.

## What is weak today (the user has not reviewed this UI)

`apps/web/src/routes/task/code.tsx` (45 lines) picks between `components/code/review.tsx` (395) and
`components/code/changes.tsx` (147); both render `components/code/code-view.tsx` (347) on `lib/code/highlight.ts`.

1. **Only changed files exist.** There is no way to open any other file of the repository; a review spot in a file
   outside the diff shows "is not part of this change. The agent may have pointed at the wrong file"
   (`review.tsx`, `CodePane`). The spec promises "a file tree and the full diff" (`docs/spec.md` → Second pass); the
   changes view is a directory-grouped flat list and shows one file at a time (`changes.tsx`, `listFileGroups`).
2. **No code once the worktree is gone.** `CodeTab` returns "The worktree is gone" when `task.worktreePath` is unset,
   and both endpoints read the worktree (`apps/server/src/http/routes.ts`, `respondDiff`, `respondFile`). A merged or
   cancelled task loses its code entirely.
3. **The review is not pinned.** File contents come from the working copy (`respondFile` reads `Bun.file`), the diff is
   recomputed on every request against a scratch index (`apps/server/src/git/diff.ts`). If the agent is still
   editing, the spot line numbers from the report drift from the code shown.
4. **Cache keyed on `task.updatedAt`.** `useTaskDiff(task.id, task.updatedAt)` and `useFileContent(..., revision)`
   (`lib/connection/files.ts`) refetch the diff and every file on any task event (a chat line, a priority change).
   The server has no cache, so each refetch reruns `git add -A --intent-to-add` and `git diff` on the worktree.
5. **Highlighting is out of context for removed lines.** `joinRemovedText` (`lib/code/rows.ts`) concatenates only
   the removed lines and tokenizes that blob, so a removed line inside a multi-line string, comment or template is
   coloured wrong. Highlighting runs Shiki on the main thread over the whole file, up to 400,000 characters
   (`MAX_HIGHLIGHTED_CHARACTERS`), with GitHub themes, not Shinsa's tokens (`app.css` `.code-token` reads
   `--shiki-light/--shiki-dark`).
6. **Every row is a DOM node.** No virtualization: expanding the gaps of a 3,000-line file renders 3,000 rows of
   spans; focus mode dims everything else with `opacity-50` per row.
7. **No find, no go to line, no word-level diff, no split view.** Browser ⌘F is the only search and it cannot see
   collapsed gaps. Changed lines are whole-line green/red with no intraline highlight.
8. **Comments only on the new side, one line each.** The comment button needs `row.newLine` (`code-view.tsx`, `Row`),
   so a deleted line cannot be commented on, and there are no ranges. Comments anchor by line number only, so they
   move if the file changes.
9. **View state is not in the URL**, against `apps/web/CLAUDE.md` ("URL state is the view state"): picking a file
   in Changes sets local state and never writes `?file=` (`changes.tsx`, `setPicked`); the review order and the
   selected spot are `useState` (`review.tsx`). Reload or Back loses your place.
10. **Fixed-width side columns** (`w-70`, `w-85`), not resizable; below `md` they stack into 2/5 of the height,
    which in a ~900px floating window leaves very little code.
11. **Smaller things.** "Open" opens the external editor but is labelled like an in-app action; binary files show
    "No text changes in this file"; risk dots exist only for `high`; no viewed/unviewed marks per file; the fallback
    report (`lib/review/fallback-report.ts`) invents spots from hunks with no way to tell they are invented except one
    line of copy; `CodeView` re-keys on `selected.path`, dropping scroll and expansion when you come back.

## Library choice

| | CodeMirror 6 | Monaco | Extend the Shiki view | `@pierre/diffs` (what T3 Code uses) |
|---|---|---|---|---|
| Size (min+gz, rough) | ~60-90 KB core, languages lazy | ~1 MB+, plus workers | ~0 new; Shiki already lazy | small + Shiki |
| Vite | plain ESM, no config | worker config, known friction | none | worker via `?worker` |
| Big files | viewport rendering, incremental Lezer parse | excellent | no virtualization today | virtualized, worker pool |
| Theming with Shinsa tokens | `EditorView.theme` takes `var(--…)` directly, both themes free | hex colours only, re-define on theme switch | CSS variable theme | Shiki themes |
| Find, go to line | `@codemirror/search` built in | built in | build it | search helper exists |
| Diffs | `@codemirror/merge`: unified with `collapseUnchanged`, split | diff editor | ours | its core |
| Editing | yes | yes | no | no |
| Feels like Shinsa | yes, fully styleable | looks like VS Code, heavy on touch | yes | yes |

**Pick CodeMirror 6.** One component covers viewer, diff, find, go to line and light editing, it themes from the
existing tokens, and it holds up on 10k-line files. Monaco's weight and hex-only theming are wrong for a
read-mostly, 900px-window app. `@pierre/diffs` is the strong runner-up for the diff panes only (T3 Code's `DiffPanel`,
`components/diffs/*` in `/tmp/refs/t3code/apps/web/src`), but it does not edit and would leave the file viewer on a
second stack. Phase 0 spikes both on the seed's large diff before committing.

Settled since: the Code tab, its merge view included, stays CodeMirror, and `@pierre/diffs` took every small diff
outside it (chat edits and writes, change snippets for spots and findings), through one lazily
loaded wrapper, `CodeDiff` (`docs/design.md`, Where Shinsa differs, 33).

Highlighting: CodeMirror's Lezer grammars (lazy per language via `@codemirror/language-data`), coloured by one
`HighlightStyle` mapped to new `--code-*` tokens in `packages/ui`. Chat code fences keep Shiki but switch to
`createCssVariablesTheme` over the same `--code-*` variables, so both read the same colours.

## Workbench shape

- **Explorer modes** (a segmented control at the top of the left column; the column is resizable, width stored in
  `lib/preferences`):
  - **Review**: today's walkthrough (sections, spots, agent findings, judgement calls, checks, your comments).
    Selecting a spot opens that file's diff tab and spotlights the range.
  - **Changes**: a collapsible tree of changed files (status letter, +/-, risk, comment count, a viewed check).
  - **Files**: the whole repository as a lazy tree; changed files carry their status letter.
- **Tabs**: a file tab (`src/a.ts`) or a diff tab (`src/a.ts` with a diff glyph). Preview tab semantics like VS Code
  (single click replaces the preview tab, double click or an edit pins it). Max ~8, oldest preview closes first.
- **Editor**: read-only CodeMirror; diff tabs use `unifiedMergeView` with `collapseUnchanged` (today's
  "N unchanged lines"), a Split toggle uses `MergeView`. Findings and comments are block widgets under their line;
  the spotlit spot is a line decoration in its attention tone.
- **Ref picker** in the toolbar: Head of the branch (default), Working copy (uncommitted agent edits, only while a
  worktree exists), Base, and each phase commit. A file opened at a ref shows the ref in its tab tooltip.
- **URL**: `?tab=code&mode=files&open=src/a.ts,src/b.ts&file=src/a.ts&line=42&diff=1&ref=<sha>&spot=1:2`, read and
  written through `useSearchParam` / `updateSearchParams`, so reload and Back restore the workbench.
- **Narrow window** (< `md`): explorer becomes a sheet opened from a toolbar button; the editor gets the full width.

### Keyboard (needs your call: design rule 14 says ⌘K is the only shortcut)

Recommended: inside the Code tab only, ⌘P (quick open), ⌘⇧F (search files), ⌘F and ⌘G (find in file, go to line,
CodeMirror's own), Esc closes. Without the exception, everything goes through ⌘K: a **Go to file** frame (a new
`Frame` kind beside `tasks` in `lib/command/menu.ts`), **Search in files**, **Go to line**. Either way the ⌘K entries
exist, so the menu stays the one complete place.

## Server endpoints (all under `createTaskRoutes`, same guard, JSON)

| Endpoint | Does | How |
|---|---|---|
| `GET /api/tasks/:id/refs` | base sha, head sha, branch, phase commits, `dirty`, worktree present | `git merge-base`, `git rev-parse`, `git log base..head`, `git status --porcelain=v2 -z` |
| `GET /api/tasks/:id/paths?ref=` | every file path at the ref (quick open) | `git ls-tree -r -z --name-only <sha>`; working copy: `git ls-files -z --cached --others --exclude-standard` |
| `GET /api/tasks/:id/tree?ref=&dir=` | one directory's entries (lazy tree) | `git ls-tree -z --long <sha> -- <dir>/` |
| `GET /api/tasks/:id/blob?ref=&path=` | `{ content, size, binary, blobSha }` | `git cat-file --batch` on one long-lived process per repo; working copy reads through `resolveInside` |
| `GET /api/tasks/:id/search?q=&ref=&regex=&case=&glob=` | matches, streamed as lines | `git grep -n -I --column -z -e <q> <sha> -- <glob>`; `--untracked --no-index` off for working copy; `rg --json` when on PATH |
| `GET /api/tasks/:id/diff?base=&head=` | today's `TaskDiff` plus `base`/`head` shas | `git diff --find-renames -z base head`; working copy keeps today's scratch-index path |

- **Security.** The repository is only ever the task's registered repo (`task.repoId`). A ref is accepted only as a
  40-hex sha that `git rev-parse --verify <sha>^{commit}` resolves in that repo, or one of the names `/refs`
  returned; never a user string passed through. Paths: relative, normalized, no `..` segment, no leading `/`, no NUL,
  always after `--`; working-copy reads keep `resolveInside` (realpath, symlinks may not escape). Search patterns go
  through `-e` with `--fixed-strings` unless `regex=1`; every git call runs with argv (no shell), a 5 s timeout and
  an abort on client disconnect; output caps: 2 MB per blob (today's `MAX_FILE_BYTES`), 200k paths, 2,000 matches.
  Binary = a NUL in the first 8 KB; images return a type so the tab can show them.
- **Caching.** Anything addressed by a sha is immutable: `ETag` = the object id, `Cache-Control: private, immutable`,
  and a server LRU (`git/objects.ts`, ~64 MB) in front of `cat-file`. Working-copy answers are keyed by
  path + mtime + size and never cached by the browser. On the web, `lib/connection/files.ts` keys by sha instead
  of `task.updatedAt`; the head sha arrives with `/refs`, refreshed when the task's `headSha` or stage changes.
- **Performance.** The diff is computed once per (base, head) and cached; the working-copy diff only when asked.

## File-level changes

- `packages/core/src/protocol/messages.ts`: `TaskRefs`, `RepoEntry`, `FileContent`, `SearchMatch`; `DiffFile.binary`.
  `packages/core/src/protocol/diff.ts`: parse `Binary files … differ`. Fuzzy path ranking either reuses
  `apps/web/src/lib/command/score.ts` or moves a pure ranker into core (T3: `packages/shared/src/searchRanking.ts`).
- `apps/server/src/git/files.ts` (new): `listPaths`, `listTree`, `readBlob` (batch process), `searchFiles`,
  `resolveTaskRefs`; `git/diff.ts`: a sha-to-sha `resolveCommitDiff` beside today's working-copy diff;
  `http/routes.ts`: the routes above; `http/paths.ts`: `assertRepoPath`. Tests under `apps/server/test/git` and
  `test/http` (throwaway repos, as today).
- `apps/web`: `routes/task/code.tsx` becomes the workbench frame; `components/code/` gains `workbench.tsx`,
  `explorer.tsx` (tree on `components/settings/virtual-rows.tsx`), `editor-tabs.tsx`, `file-editor.tsx`,
  `diff-editor.tsx`, `ref-picker.tsx`, `search-panel.tsx`, `quick-open.tsx`; `review.tsx` keeps the walkthrough and
  loses `CodePane`; `code-view.tsx`, `lib/code/rows.ts`, `lib/code/diff.ts` row model and `joinRemovedText` go.
  `lib/code/`: `tree.ts`, `tabs.ts` (URL), `languages.ts`, `theme.ts`, `search.ts`, `suggestions.ts`;
  `lib/connection/files.ts`: refs, paths, tree, blob, search; `lib/tasks/tabs.ts`: `CodeView` gets `files`;
  `lib/command/menu.ts` + `task.ts`: Go to file, Search in files, Go to line, Open at ref.
- `packages/ui`: `--code-*` tokens (keyword, string, number, comment, function, type, punctuation, added/removed
  wash) in both themes; `/ui` showcase specimens for the editor in each state.
- Docs in the same change: `docs/design.md` (a Code tab section: workbench, modes, tabs, the keys), `docs/spec.md`,
  `docs/engine.md` (the endpoints), `apps/web/CLAUDE.md` layout table.

## Editing: direct, in the working copy (decided 2026-10-25)

The plan first kept the editor read-mostly, with edits as suggestions sent with Request changes, because Shinsa owns
every commit and an agent may be working in the same checkout. You chose direct editing instead, so:

1. **Typing edits.** At Head of the branch or the Working copy of an open task the editor is editable with no mode,
   in a diff on its new side; ⌘Z undoes. Each pause saves the file to the task's working copy, through the
   workspace strategy, with the text the editor expects on disk, so it never overwrites an agent's write it has not
   seen (the editor merges or shows the disk version instead).
2. **Shinsa still commits.** Your edits go into the round's next commit; approving the review commits any no
   hand-over took before it pushes; the merge gate waits for them. The agent is told which files you edited.
3. **Not built:** commits authored as you (`git commit --author`), and a per-file record of who wrote which line
   while an agent edits the same file.

## Phases and acceptance checks

0. **Spike (1 day).** CodeMirror merge view vs `@pierre/diffs` on the seed's 5k-line file diff, in both themes, at
   900px. Pass: 60 fps scroll, < 150 ms to first paint of a 5k-line diff, `vite build` adds < 150 KB gzip to the
   lazy Code chunk, colours from Shinsa tokens. Pick, record in `docs/design.md`.
1. **Read endpoints + seed (2 days).** `/refs`, `/paths`, `/tree`, `/blob`, sha-pinned `/diff`. Pass: a merged
   seed task with no worktree shows its diff and any file; `../etc/passwd`, an absolute path, a symlink out of the
   worktree and a non-sha ref are refused with 400; the same sha served twice hits the cache (304); 100% coverage.
2. **Files mode + viewer (3 days).** Lazy tree, tabs, CodeMirror viewer, find and go to line, ref picker, quick open
   through ⌘K (and ⌘P if allowed), URL state. Pass: open any file of a 1,000-file repo by name in < 3 keystrokes;
   a 10k-line file scrolls smoothly; reload restores tabs, file and line.
3. **Diffs rebuilt (3 days).** Changes and Review on `diff-editor.tsx`: unified/split, collapse unchanged, intraline
   changes, findings and comments as widgets, comments on deleted lines and ranges, viewed marks, spots in files
   outside the diff open the file. Pass: every existing review test passes on the new component; the old
   `code-view.tsx` and row model are deleted; a removed line inside a block comment is coloured as a comment.
4. **Search in files (1-2 days).** Panel in the explorer column, streamed results grouped by file, click opens at the
   line, case and regex toggles. Pass: a search over the seed repo returns in < 1 s; a regex that runs away is cut at
   5 s with a message; results at a past ref match `git grep` at that ref.
5. **Editing (done 2026-10-25, direct instead of suggestions).** Pass: typing at the head saves to the working copy,
   survives a reload, reaches the next commit, and the agent's next turn names the file.

## Seed data for trying it (`scripts/seed-code.ts`, new, called from `scripts/seed.ts`)

Today `bun run seed` (`scripts/seed.ts`, `createWorktrees`) makes five worktrees on toy repos of 2-7 files, each file
under ~60 lines: the embedded-chat review (2 files changed, 1 deleted, a report with sections, spots, judgement calls
and one finding), the duplicate fix (3 files, committed), the tab scroll fix and the usage defaults (uncommitted),
and a rounds stack (`seed-rounds.ts`). Missing for the code views: a repository big enough for quick open, the tree
and search; a large file; a rename with edits; a binary; a lockfile; a mix of committed phases and uncommitted edits;
several findings of different severities; a spot outside the diff; and a merged task whose worktree is gone.

Add one repository, `shinsa-sample`, built offline from this checkout at the pinned commit `3590252` (never `HEAD`,
so later renames cannot break it): `git archive` of that commit unpacked into `~/.shinsa-seed/repos/shinsa-sample` and committed (about a thousand real files in
TS, TSX, CSS, Markdown and JSON). On it:

- **"Rename review targets to review spots"**, at the review gate: three phase commits plus one uncommitted edit;
  ~12 files modified, one renamed with edits (`lib/review/targets.ts` → `spots.ts`), one deleted, two added (one a
  test), `bun.lock` touched (low risk), a generated 5,000-line file with a 3-line change, a PNG replaced (binary).
  A report with three sections and nine spots across critical/high/normal, one spot in a file outside the diff,
  two judgement calls with file and line, checks with one failed then passed. Agent review: one blocking finding,
  two suggestions, one nit, one on a line next to a deletion.
- **"Stack the queue by priority"**, merged: branch kept, worktree removed, pull request merged, to prove the
  Code tab works from git objects alone.
- **"Add a dark theme to the code view"**, building (live): a running builder with uncommitted edits so Working
  copy and Head differ.

## Risks

- `@codemirror/merge` widget placement in unified view next to deleted chunks needs care; the spike tests exactly
  that before anything else moves.
- `git cat-file --batch` long-lived processes need lifecycle handling (one per repo, killed on idle and shutdown).
- Big monorepos: 200k paths is ~10 MB of JSON; cap it and fall back to server-side filtering by prefix if hit.
- Two highlighters (Lezer in the editor, Shiki in chat) can disagree on token kinds; same variables keep colours close,
  not identical.
- The 100% coverage floor makes the web rework large: `code-view.tsx` behaviour tests need rewriting against
  CodeMirror's DOM (happy-dom lacks layout; keep logic in `lib/code/*.ts` so most tests stay pure).

## Questions only you can answer

1. May the Code tab bind ⌘P, ⌘⇧F, ⌘F and ⌘G while it is open (an exception to "⌘K is the only shortcut"), or
   should all of it go through ⌘K?
2. ~~Editing: suggestions or Commit as you?~~ Answered 2026-10-25: direct editing, Shinsa commits.
3. Should Files mode exist on tasks without code changes (questions, investigations), browsing the repository at its
   default branch, or only on tasks with a Code tab?
4. ~~Default diff layout?~~ Answered 2026-10-25: side by side, unified is the remembered toggle.
5. Is it fine for the seed to snapshot this repository's own code as `shinsa-sample`, or do you prefer a pinned
   public repository cloned at seed time (needs the network)?
