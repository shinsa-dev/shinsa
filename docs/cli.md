# The `shinsa` command line

You never have to run the command line. The Shinsa app sets up the engine, keeps it running in the background as a
login item (`docs/engine.md` → The engine in the background) and does everything the command line does. The
`shinsa` command is for doing things from a terminal, and for agents, which get the same surface as tools.

## How it is shaped

Shinsa is built like Tailscale and Docker Desktop: an app, a daemon that always runs, and a command line that talks
to the daemon. The two set the pattern; Shinsa takes what works from each.

| | Tailscale | Docker Desktop | Shinsa |
| --- | --- | --- | --- |
| The daemon | `tailscaled`, its own binary, run by systemd or the macOS app | `dockerd`, run by the app inside its VM | the app's own engine, the same binary as the command, run by launchd as a login item |
| Running the daemon by hand | `tailscaled` is not a `tailscale` command | not a `docker` command | not in the help: `shinsa engine` exists only for the launchd job and `bun dev` |
| Daemon controls | `up`, `down`, `status` (exits 1 when stopped), `version` (with `--daemon`) | `docker desktop start`, `stop`, `restart`, `status`, `logs`, `version`, `update` | `start`, `stop`, `restart` (also `--when-idle`), `status`, `logs`, `version`, at the top level |
| Day-to-day work | one flat list of verbs (`ping`, `ssh`, `file`, `serve`) | `docker --help` puts Common Commands first, then Management Commands (`container`, `image`, `system`…) | the commands that open Shinsa and hand it work first (`.`, `open`, `do`, `import`), then the engine's, then the groups, each section titled by what its commands do |
| When the daemon is down | commands fail and say so | commands fail and say so | a command that needs the engine starts it through launchd and carries on; only `status` and `version` report without starting it |
| Machine output | `--json` on some commands | `--format json` on some commands | `--json` on every command, with errors as JSON too |

What Shinsa takes:

- **The daemon is not a user command.** Tailscale and Docker never ask you to start their daemon from their CLI;
  their app or the system's service manager does. Shinsa's engine is the same executable as the command, so it keeps
  an entry for launchd (`shinsa engine`), left out of the help and refused in an agent's shell, as `stop` and
  `restart` are, since the engine is what runs the agent.
- **Lifecycle at the top level, like Tailscale.** There are five controls, too few for a group of their own (Docker
  needs `docker desktop` because `docker start` already starts a container). They are `start` and `stop` rather than
  Tailscale's `up` and `down`, which connect and disconnect while `tailscaled` keeps running; Shinsa has nothing
  between running and stopped.
- **The help is Docker's.** The everyday commands come first, then the engine, then every group in one line under
  its section, examples, and how to go deeper (`shinsa <group>`, `--help`, `shinsa help --all`). Every command,
  everyday ones included, prints its usage, what it does, its options and examples under `--help`.
- **`version` names both sides**, like `docker version`'s Client and Server: this command's version and the engine's,
  and says when the engine runs another version than the app carries.
- **Better than either:** a command never fails because the engine is asleep (it starts it and waits), `restart
  --when-idle` waits until no agent is mid-turn, and the whole surface is also every task agent's tools, generated
  from the same specs.
- **`do` stays `do`.** It hands over any kind of work (a change, a question, an investigation), so a noun such as
  `new` or `create` would undersell it; `shinsa tasks create` is the long form with every option.

## How it looks

The output is set the way gh, Bun, uv and Vercel set theirs: a terminal gets a little colour and structure, and a
pipe gets the same words as plain text. One module draws it all, `apps/engine/src/terminal/` (no dependency), and every
command takes its `Display` (a style and a width) from it.

- **When there is colour.** Colour and symbols only when the stream is a terminal. `FORCE_COLOR` turns colour on
  (and symbols with it, even into a pipe) or, as `0` or `false`, off, and wins over everything; `NO_COLOR` (not
  empty) and `TERM=dumb` turn it off; `TERM=dumb` also drops the symbols, and `TERM=linux` draws ASCII ones (`*`,
  `v`, `x`, `...`). Standard output and standard error are decided apart, so `shinsa status 2>&1 | less` stays plain
  while errors in the terminal are red. `--json` is never styled.
- **The 16 terminal colours only**, so the user's theme decides the exact shade on a dark or a light background:
  bold for headings, the names that matter (`Running`, a task's handle) and the error prefix; dim for what is
  secondary (labels, paths, timestamps, URLs, hints); cyan as the accent for commands, flags and code in backticks
  (the backticks go); green for done and ready to merge; yellow for what waits on you and warnings; red for paused,
  stopped and errors; blue only for a log's `info`. No 256-colour or RGB codes.
- **Width.** A terminal's width (`COLUMNS` overrides it) wraps help and paragraphs with a hanging indent under their
  column, puts a description below its term when the column would be narrower than 32, and fits tables by shrinking
  their widest column first, cut with an ellipsis; a task's handle never shrinks, and neither do the queue's labels
  and links. A pipe has no width: nothing wraps or is cut, so `grep` sees whole lines.
- **Help** (`shinsa`, `shinsa <group>`, `--help` on any command): a bold heading per section, terms in the accent
  with their arguments dim, descriptions aligned in one column across the whole page, and the version dim after the
  line that says what Shinsa is.
- **`status`** opens with the engine's state (a green dot and Running, or a red dot and Stopped with the command that
  starts it), then its version, uptime, address, pid, install path and data folder as dim labels with `~` for the home
  folder, then the Home guide, then Needs you and Agents working as one aligned table: handle, label coloured by
  what kind of decision it is, title, link. With nothing to show it says "Nothing needs you, and no agent is working."
  `shinsa queue` prints the same table, and `shinsa tasks list` a table with Task, Title, Status and Repository.
- **Outcomes** are one line: a green check before what happened, the details dim after it (`✔ Started the engine in
  1.2s. Shinsa 0.4.2, pid 812.`). `start`, `stop` and `restart` show a spinner on standard error while they wait,
  and only on a terminal.
- **Errors** are `Error:` in bold red and the message, then a dim line with what to do: the first sentence of the
  message that names a command and everything after it (`splitHint`). An unknown command, group action or option
  names the closest one (`Did you mean shinsa status?`): a word a slip or two of the keys away, or the only command
  that starts with what you typed, when that is three letters or more.
- **`logs`**: the time dim, the level coloured, the `[Area]` bold, each field's key dim.

The text an agent's management tool gets is the same as a pipe's: plain, unwrapped, no symbols.

## Where commands go

Every command talks to the engine on the configured host (`SHINSA_HOST` or `hostname` in `config.json`; 127.0.0.1
when the engine listens on every address) and port (`SHINSA_PORT` or `port` in `config.json`, else 7446; a `bun dev` engine is on 5180, so a command from source reaches it with `SHINSA_PORT=5180`). When the
Mac app runs the engine and it is not answering, a command asks launchd to start it and waits for it; `status` and
`version` only report. `start`, `stop` and `restart` work only with the `shinsa` the app puts on your PATH
(`~/.local/bin/shinsa`, linked on every launch, in zsh, bash and fish), on the engine the app set up; from source, `bun dev` runs the engine in a terminal.

<!-- Everything below is generated from apps/engine/src/cli and apps/engine/src/surface by `bun run --cwd apps/engine docs:cli`, and a test fails when it falls behind. -->

## Open Shinsa and hand it work

### shinsa [folder]

Open the app; in a repository, open it on that repository’s project. Alone it opens the app on Home. With a folder it focuses the app on the project of the repository the folder is in, or says that Shinsa has not worked there yet.

```
shinsa [folder]
$ shinsa
$ shinsa .
$ shinsa ~/Developer/shop
```

### shinsa open

Open the app on a task, by its handle (SW-142), id or title. Without a task it opens the app on Home; a folder works as it does for `shinsa <folder>`.

```
shinsa open [task]
$ shinsa open SW-142
```

### shinsa do

Create a task from a request; Shinsa picks the kind of work and runs it. The folder you run it in tells triage where the work is. Shinsa classifies the request, plans it and builds it, and brings it back when it needs a decision.

```
shinsa do <request...> [--plan-first | --backlog] [--urgent | --high]
$ shinsa do "fix the scroll in tab groups"
$ shinsa do "add search to the docs" --plan-first
```

| Option | What it does |
| --- | --- |
| `--plan-first` | Wait for you to approve a plan before building. |
| `--backlog` | Plan it now and keep it in the backlog until you start building it. |
| `--urgent` | Put it ahead of everything else. |
| `--high` | Put it ahead of normal work. |

### shinsa import

Create a task from a Claude Code session, starting with a plan to approve. Takes a session file (.jsonl) or a session id. The task starts with a plan for you to approve, so nothing builds until you have looked.

```
shinsa import <session> [--in <folder>] [--urgent | --high]
$ shinsa import 0b9c2f4e-6a8d
$ shinsa import ~/session.jsonl --in ~/Developer/shop
```

| Option | What it does |
| --- | --- |
| `--in <folder>` | Work in this folder instead of the one the session ran in. |
| `--urgent` | Put it ahead of everything else. |
| `--high` | Put it ahead of normal work. |

## Check and control the background engine

### shinsa status

Show whether the engine runs, what needs you and what agents are doing. Shows the engine’s version and data folder, the Home guide, the decisions waiting for you and what agents are working on. Exits with 1 when the engine is not running, and never starts it.

```
shinsa status [--json]
$ shinsa status
```

| Option | What it does |
| --- | --- |
| `--json` | Print the answer as JSON. |

### shinsa start

Start the engine in the background and wait until it answers. On a Mac with the Shinsa app, asks launchd to start the engine the app set up. On a Mac without it, sets the engine up as its own launchd agent the first time (it starts at login and again after a crash) and starts it; it never starts a second engine beside the app’s. On Linux, sets the engine up as a systemd user service the first time (it starts at boot once lingering is on, and again after a crash) and starts it. Then waits until it answers. Any other command that needs the engine starts it the same way.

```
shinsa start
$ shinsa start
```

### shinsa stop

Stop the engine cleanly. Runs resume when it starts again. Waits until it has stopped cleanly. It stays stopped until `shinsa start`, the Shinsa app or a command that needs it starts it again, or until you next log in. An engine still running after 40 seconds is killed; on a Mac, launchd then starts a fresh one.

```
shinsa stop
$ shinsa stop
```

Yours alone: an agent’s shell may not run it, since the engine runs the agent.

### shinsa restart

Restart the engine now, or with --when-idle once no agent is mid-turn. Restarts the engine and waits until the new one answers. Runs it cuts off resume on their own sessions.

```
shinsa restart [--when-idle]
$ shinsa restart
$ shinsa restart --when-idle
```

| Option | What it does |
| --- | --- |
| `--when-idle` | Wait until no agent is mid-turn, then restart. |

Yours alone: an agent’s shell may not run it, since the engine runs the agent.

### shinsa logs

Print the last lines of the engine’s log, 50 unless --lines says more. Reads `engine.log` in the data folder, one line per entry: the time in UTC, the level, the message and its fields.

```
shinsa logs [--lines <count>] [--json]
$ shinsa logs
$ shinsa logs --lines 200
```

| Option | What it does |
| --- | --- |
| `--lines <count>` | How many lines, 50 by default. |
| `--json` | Print the lines as the engine wrote them. |

### shinsa version

Print the version of this command and of the running engine. Also `shinsa --version`. Says when the engine runs another version than the app carries.

```
shinsa version [--json]
$ shinsa version
```

| Option | What it does |
| --- | --- |
| `--json` | Print the answer as JSON. |

## The groups

Generated from the specs in `apps/engine/src/surface`. How the surface works is `docs/engine.md` → The command
surface.

`--help` on a group or a command prints its usage; `--json` prints the answer as JSON, and a refusal as
`{ "error": { "code", "message" } }` with exit code 1. A task is named by its handle (SW-142), its id, the start of
its id or its exact title; an account by id or email; a repository by name or id; a project by key, name or id.
Every task agent has each command that is not yours alone as a tool of the same name with `_` for spaces and
dashes, taking the same fields in snake_case; what it does is logged as on your behalf from its task. A command
marked yours alone has no tool (`docs/engine.md` → Who can change Shinsa), and `tasks create` has none either:
an agent files a task with `create_task`, which files it once however often the call is repeated.

### tasks

#### shinsa tasks list

List tasks, most recently changed first.

```
shinsa tasks list [--status <open|needs_you|settled|all>] [--query <text>] [--repo <text>] [--limit <integer>] [--json]
```

Every task agent's tool: `tasks_list` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `--status` | choice, optional | open (the default), needs_you, settled or all. |
| `--query` | text, optional | Words that must all appear in the title, request, branch or repository. |
| `--repo` | text, optional | Only tasks in this repository (name or id). |
| `--limit` | integer, optional | At most this many tasks (50 by default). |

#### shinsa tasks show

Show a task: its state, plan, open decisions and recent activity.

```
shinsa tasks show <task> [--json]
```

Every task agent's tool: `tasks_show` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks chat

Read a task's chat: your messages, the agents' replies and, on request, their tool calls.

```
shinsa tasks chat <task> [--run <text>] [--kinds <list>] [--after <integer>] [--limit <integer>] [--json]
```

Every task agent's tool: `tasks_chat` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `--run` | text, optional | Only this run. |
| `--kinds` | list, optional | Entry kinds: user, agent, error (the default), tool_call, tool_result, status, notice. |
| `--after` | integer, optional | Entries after this index, oldest first. |
| `--limit` | integer, optional | At most this many entries (50 by default; the latest without after). |

#### shinsa tasks diff

List the files a task changed against its base branch.

```
shinsa tasks diff <task> [--json]
```

Every task agent's tool: `tasks_diff` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks create

Create a task. Shinsa classifies it, plans it and builds it.

```
shinsa tasks create <request...> [--repo <text>] [--project <text>] [--priority <urgent|high|normal|low>] [--plan-first] [--backlog] [--ask] [--after <list>] [--fork-from <text>] [--account <text>] [--json]
```

Not a task agent's tool: an agent uses `create_task` instead. Sends `task.create`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<request>` | text, required | What should be done. The first line becomes the title. |
| `--repo` | text, optional | The repository (name or id). Triage picks one when left out. |
| `--project` | text, optional | The project (key, name or id), or none. Left out, it is the repository’s project, else the one in focus. |
| `--priority` | choice, optional | low, normal, high or urgent. |
| `--plan-first` | boolean, optional | Wait for you to approve the plan before building. |
| `--backlog` | boolean, optional | Plan it now and keep it in the backlog until you start building it. |
| `--ask` | boolean, optional | Only answer a question: no changes, branch or pull request. |
| `--after` | list, optional | Tasks it waits on before it starts. |
| `--fork-from` | text, optional | A task to fork: the new task’s agent starts from a copy of its conversation. |
| `--account` | text, optional | Run it on this Claude account (id or email). |

#### shinsa tasks message

Send a message to a task's agent. At an open decision it is your feedback, never an approval.

```
shinsa tasks message <task> <text...> [--as <feedback|acknowledge|new_round|separate_task>] [--json]
```

Every task agent's tool: `tasks_message`. Sends `task.message`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<text>` | text, required | The message. |
| `--as` | choice, optional | feedback on the current round (a follow-up on a finished one), acknowledge for a message that needs nothing, new_round for new work in this task, or separate_task to suggest it as its own task. Left out, Shinsa decides. |

#### shinsa tasks retry

Restart a paused task's current step with a fresh fix budget.

```
shinsa tasks retry <task> [--account <text>] [--json]
```

Every task agent's tool: `tasks_retry`. Sends `task.retry`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `--account` | text, optional | Run the step on this account (id or email). |

#### shinsa tasks rerun

Run the current step again on a chosen Claude account.

```
shinsa tasks rerun <task> <account> [--json]
```

Every task agent's tool: `tasks_rerun`. Sends `task.retry`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<account>` | text, required | The account (id or email). |

#### shinsa tasks cancel

Cancel a task. Its agents stop and its worktree is removed.

```
shinsa tasks cancel <task> [--json]
```

Every task agent's tool: `tasks_cancel`. Sends `task.cancel`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks duplicate

Close a task as a duplicate of another. It is cancelled and links the task it duplicates.

```
shinsa tasks duplicate <task> --of <text> [--json]
```

Every task agent's tool: `tasks_duplicate`. Sends `task.mark_duplicate`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `--of` | text, required | The task it duplicates: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks not-duplicate

Start a task closed as a duplicate again. One that already worked starts a fresh round.

```
shinsa tasks not-duplicate <task> [--json]
```

Every task agent's tool: `tasks_not_duplicate`. Sends `task.clear_duplicate`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks done

Mark a task as done without merging it.

```
shinsa tasks done <task> [--json]
```

Every task agent's tool: `tasks_done`. Sends `task.complete`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks prioritize

Change how soon a task reaches you.

```
shinsa tasks prioritize <task> <priority> [--json]
```

Every task agent's tool: `tasks_prioritize`. Sends `task.prioritize`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<priority>` | choice, required | low, normal, high or urgent. |

#### shinsa tasks wait-on

Make a task wait on other tasks. The list replaces the tasks it waits on now.

```
shinsa tasks wait-on <task> <waitsOn...> [--json]
```

Every task agent's tool: `tasks_wait_on`. Sends `task.wait_on`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<waitsOn>` | list, required | The tasks it waits on. |

#### shinsa tasks stop-waiting

Stop a task waiting on other tasks.

```
shinsa tasks stop-waiting <task> [--json]
```

Every task agent's tool: `tasks_stop_waiting`. Sends `task.wait_on`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks move-to-backlog

Keep a task in the backlog: its plan waits there until you start building it.

```
shinsa tasks move-to-backlog <task> [--json]
```

Every task agent's tool: `tasks_move_to_backlog`. Sends `task.move_to_backlog`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks remove-from-backlog

Take a task out of the backlog: its plan waits for you in Needs you.

```
shinsa tasks remove-from-backlog <task> [--json]
```

Every task agent's tool: `tasks_remove_from_backlog`. Sends `task.remove_from_backlog`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks snooze

Snooze a task: it keeps its step and its work, and leaves Needs you and Home until you unsnooze it.

```
shinsa tasks snooze <task> [--json]
```

Every task agent's tool: `tasks_snooze`. Sends `task.snooze`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks unsnooze

Unsnooze a task: it shows again where it was, in Needs you when it waits for you.

```
shinsa tasks unsnooze <task> [--json]
```

Every task agent's tool: `tasks_unsnooze`. Sends `task.unsnooze`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks bind

Run a task on one Claude account, or on any account again.

```
shinsa tasks bind <task> <account> [--json]
```

Every task agent's tool: `tasks_bind`. Sends `task.bind_account`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<account>` | text, required | The account (id or email), or any. |

#### shinsa tasks check-in-now

Fire a waiting agent's next check-in now.

```
shinsa tasks check-in-now <task> [--json]
```

Every task agent's tool: `tasks_check_in_now`. Sends `monitor.check_in_now`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks resume-now

Resume a task that waits for a usage limit to reset, now.

```
shinsa tasks resume-now <task> [--json]
```

Every task agent's tool: `tasks_resume_now`. Sends `usage_wait.resume_now`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa tasks auto-resume

Choose whether a task waiting for a usage limit resumes by itself at the reset.

```
shinsa tasks auto-resume <task> <resume> [--json]
```

Every task agent's tool: `tasks_auto_resume`. Sends `usage_wait.change`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<resume>` | boolean, required | true to resume at the reset, false to wait for you. |

#### shinsa tasks open

Open a task's worktree in your editor, a terminal or Finder.

```
shinsa tasks open <task> [<in>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<in>` | choice, optional | editor (the default), terminal or finder. |

### rounds

#### shinsa rounds ship

Choose how a round ships: onto the task’s open pull request, or as its own stacked pull request.

```
shinsa rounds ship <task> <round> <how> [--json]
```

Every task agent's tool: `rounds_ship`. Sends `round.ship`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<round>` | integer, required | The round number, from `shinsa tasks show`. |
| `<how>` | choice, required | onto_pull_request or stacked. |

#### shinsa rounds update

Change what a queued round asks for, before it starts.

```
shinsa rounds update <task> <round> <text...> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `round.update`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<round>` | integer, required | The number of a round that waits to start, from `shinsa tasks show`. |
| `<text>` | text, required | What the round asks for instead. |

#### shinsa rounds remove

Remove a queued round before it starts. The rounds after it move up.

```
shinsa rounds remove <task> <round> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `round.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<round>` | integer, required | The number of a round that waits to start, from `shinsa tasks show`. |

#### shinsa rounds send

Send a queued round to the current round now, as a message, instead of waiting.

```
shinsa rounds send <task> <round> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `round.send`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<round>` | integer, required | The number of a round that waits to start, from `shinsa tasks show`. |

### gates

#### shinsa gates answer

Answer any open decision by its gate id.

```
shinsa gates answer <gate> --decision <approve|revise|reject|reply> [--response <text>] [--plan-version <integer>] [--verdicts <json>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<gate>` | text, required | The gate id, from `shinsa tasks show`. |
| `--decision` | choice, required | approve, revise, reject or reply. |
| `--response` | text, optional | Your reply or feedback. |
| `--plan-version` | integer, optional | The plan version you read, for a plan. |
| `--verdicts` | json, optional | Review verdicts: [{"index":0,"verdict":"fix","note":null}]. |

#### shinsa gates secret

Give an agent the secret it asked for. It goes to the secret store, never to the chat.

```
shinsa gates secret <gate> <value> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<gate>` | text, required | The gate id, from `shinsa tasks show`. |
| `<value>` | text, required | The secret. |

#### shinsa gates decline-secret

Decline to give an agent the secret it asked for.

```
shinsa gates decline-secret <gate> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<gate>` | text, required | The gate id, from `shinsa tasks show`. |

### plans

#### shinsa plans approve

Approve the plan of a task, so building starts.

```
shinsa plans approve <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa plans revise

Ask the agent to revise the plan.

```
shinsa plans revise <task> <feedback...> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<feedback>` | text, required | What should change. |

#### shinsa plans reject

Reject the plan and cancel the task.

```
shinsa plans reject <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

### reviews

#### shinsa reviews approve

Approve the changes of a task, so Shinsa opens the pull request.

```
shinsa reviews approve <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa reviews revise

Request changes; the agent makes them.

```
shinsa reviews revise <task> <feedback...> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<feedback>` | text, required | What should change. |

#### shinsa reviews reject

Reject the changes and cancel the task.

```
shinsa reviews reject <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa reviews verdicts

Decide each finding of an escalated review: fix it or dismiss it. Dismissing all of them approves.

```
shinsa reviews verdicts <task> [--fix <list>] [--dismiss <list>] [--note <text>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `--fix` | list, optional | Finding numbers to fix (from 0). |
| `--dismiss` | list, optional | Finding numbers to dismiss (from 0). |
| `--note` | text, optional | A note for the agent. |

### merges

#### shinsa merges approve

Merge the pull request of a task.

```
shinsa merges approve <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa merges reject

Do not merge; cancel the task.

```
shinsa merges reject <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa merges tick

Tick a pre-merge or post-merge step you did (a variable set, a migration run). The merge waits for every pre-merge step; a post-merge step ticks only once the pull request merged.

```
shinsa merges tick <task> <step...> [--undo] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `merge_step.tick`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<step>` | text, required | The step: its number in `shinsa tasks show`, from 1, or its title. |
| `--undo` | boolean, optional | Untick it instead. |

### operations

#### shinsa operations run

Run the operation of a change that merged. Notes replace the ones saved on the operation.

```
shinsa operations run <task> [<notes...>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<notes>` | text, optional | Notes for the agent. |

#### shinsa operations finish

Finish a task whose change merged without running its operation.

```
shinsa operations finish <task> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

### questions

#### shinsa questions answer

Answer an agent's question on a task.

```
shinsa questions answer <task> <answer...> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `gate.answer`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<answer>` | text, required | Your answer. |

### suggestions

#### shinsa suggestions list

List the tasks agents suggested on a task.

```
shinsa suggestions list <task> [--json]
```

Every task agent's tool: `suggestions_list` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |

#### shinsa suggestions accept

Add a suggested task as a task of its own.

```
shinsa suggestions accept <task> <suggestion> [--after-this] [--backlog] [--json]
```

Every task agent's tool: `suggestions_accept`. Sends `suggestion.accept`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<suggestion>` | text, required | The suggested task id, from `shinsa suggestions list`. |
| `--after-this` | boolean, optional | Start it only after this task merges. |
| `--backlog` | boolean, optional | Plan it now and keep it in the backlog until you start building it. |

#### shinsa suggestions dismiss

Dismiss a suggested task.

```
shinsa suggestions dismiss <task> <suggestion> [--json]
```

Every task agent's tool: `suggestions_dismiss`. Sends `suggestion.dismiss`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<suggestion>` | text, required | The suggested task id, from `shinsa suggestions list`. |

#### shinsa suggestions keep

Keep a suggested task in this task instead: it goes to the agent now.

```
shinsa suggestions keep <task> <suggestion> [--json]
```

Every task agent's tool: `suggestions_keep`. Sends `suggestion.keep`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<suggestion>` | text, required | The suggested task id, from `shinsa suggestions list`. |

### runs

#### shinsa runs snooze

Snooze the warning about an agent that has gone quiet.

```
shinsa runs snooze <run> [--minutes <integer>] [--json]
```

Every task agent's tool: `runs_snooze`. Sends `run.snooze_silence`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<run>` | text, required | The run id, from `shinsa tasks show --json` or `shinsa delegations list`. |
| `--minutes` | integer, optional | For this many minutes (30 by default). |

#### shinsa runs dismiss

Dismiss the quiet-agent warning for the rest of a run.

```
shinsa runs dismiss <run> [--json]
```

Every task agent's tool: `runs_dismiss`. Sends `run.dismiss_silence`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<run>` | text, required | The run id, from `shinsa tasks show --json` or `shinsa delegations list`. |

### delegations

#### shinsa delegations list

List the delegations: work agents handed to other agents.

```
shinsa delegations list [--task <text>] [--json]
```

Every task agent's tool: `delegations_list` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `--task` | text, optional | Only this task (id, start of the id, or exact title). |

#### shinsa delegations stop

Stop a delegation and every delegation it started.

```
shinsa delegations stop <run> [--json]
```

Every task agent's tool: `delegations_stop`. Sends `delegation.cancel`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<run>` | text, required | The run id, from `shinsa tasks show --json` or `shinsa delegations list`. |

### schedules

#### shinsa schedules list

List the schedules: what each sends, when, and whether it is on.

```
shinsa schedules list [--json]
```

Every task agent's tool: `schedules_list` (reads).

#### shinsa schedules write

Create a schedule, or change one with --id: it starts a new task, messages a task or reads a data source, once, on an interval, daily or when its webhook is called.

```
shinsa schedules write [--id <text>] [--name <text>] [--message <text>] [--in-minutes <integer>] [--run-at <text>] [--every-minutes <integer>] [--daily-at <text>] [--weekdays <list>] [--webhook] [--signature-header <text>] [--signature-encoding <hex|base64>] [--signature-prefix <text>] [--replay-key <text>] [--new-task] [--repo <text>] [--priority <urgent|high|normal|low>] [--just-answer] [--task <text>] [--source <text>] [--project <text>] [--enabled] [--max-runs <integer>] [--time-zone <text>] [--json]
```

Every task agent's tool: `schedules_write`. Sends `schedule.write`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `--id` | text, optional | The schedule to change. Leave out to create one. |
| `--name` | text, optional | A short name. |
| `--message` | text, optional | What it sends: the request of the new task, or the message. A webhook may use {{body.path}}. |
| `--in-minutes` | integer, optional | Once, this many minutes from now. |
| `--run-at` | text, optional | Once, at this ISO 8601 time. |
| `--every-minutes` | integer, optional | Repeatedly, every this many minutes. |
| `--daily-at` | text, optional | Every day at this 24-hour HH:MM. |
| `--weekdays` | list, optional | With --daily-at: only these days, 0 for Sunday. |
| `--webhook` | boolean, optional | Run when its webhook URL is called. |
| `--signature-header` | text, optional | With --webhook: the header carrying an HMAC-SHA256 signature. |
| `--signature-encoding` | choice, optional | hex (the default) or base64. |
| `--signature-prefix` | text, optional | Text before the signature, such as sha256=. |
| `--replay-key` | text, optional | With --webhook: a template that names a delivery, so a repeat starts nothing. |
| `--new-task` | boolean, optional | Start a new task on each run. |
| `--repo` | text, optional | With --new-task: the repository (name or id). |
| `--priority` | choice, optional | With --new-task: its priority. |
| `--just-answer` | boolean, optional | With --new-task: only answer a question. |
| `--task` | text, optional | Message this task on each run instead. |
| `--source` | text, optional | Read this data source of the project (its server) on each run and file a task for each new report. Without --task, a task to read it in is created. |
| `--project` | text, optional | With --source: the project the data source belongs to. |
| `--enabled` | boolean, optional | false saves it paused. |
| `--max-runs` | integer, optional | Stop after this many runs. |
| `--time-zone` | text, optional | IANA time zone for --daily-at. The machine’s by default. |

#### shinsa schedules enable

Turn a paused schedule back on.

```
shinsa schedules enable <schedule> [--json]
```

Every task agent's tool: `schedules_enable`. Sends `schedule.enable`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<schedule>` | text, required | The schedule id, from `shinsa schedules list`. |

#### shinsa schedules disable

Pause a schedule.

```
shinsa schedules disable <schedule> [--json]
```

Every task agent's tool: `schedules_disable`. Sends `schedule.enable`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<schedule>` | text, required | The schedule id, from `shinsa schedules list`. |

#### shinsa schedules delete

Delete a schedule. A webhook schedule’s URL stops working.

```
shinsa schedules delete <schedule> [--json]
```

Every task agent's tool: `schedules_delete`. Sends `schedule.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<schedule>` | text, required | The schedule id, from `shinsa schedules list`. |

#### shinsa schedules suggestions

List the suggested watches that wait for you to accept or dismiss them.

```
shinsa schedules suggestions [--json]
```

Every task agent's tool: `schedules_suggestions` (reads).

#### shinsa schedules accept

Accept a suggested watch: it starts reading its data source on its schedule.

```
shinsa schedules accept <suggestion> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `watch_suggestion.accept`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<suggestion>` | text, required | The suggested watch, from `shinsa schedules suggestions`. |

#### shinsa schedules dismiss

Dismiss a suggested watch. It is not suggested again.

```
shinsa schedules dismiss <suggestion> [--json]
```

Every task agent's tool: `schedules_dismiss`. Sends `watch_suggestion.dismiss`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<suggestion>` | text, required | The suggested watch, from `shinsa schedules suggestions`. |

#### shinsa schedules webhook

Show a webhook schedule's URL and its signature check.

```
shinsa schedules webhook <schedule> [--json]
```

Every task agent's tool: `schedules_webhook` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<schedule>` | text, required | The schedule id, from `shinsa schedules list`. |

#### shinsa schedules webhook-secret

Set the signing secret a webhook schedule checks requests against. It stays in Shinsa's secret store.

```
shinsa schedules webhook-secret <schedule> <secret> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<schedule>` | text, required | The schedule id, from `shinsa schedules list`. |
| `<secret>` | text, required | The signing secret. |

### memory

#### shinsa memory list

List the rules agents remember, and the ones agents proposed that wait for you.

```
shinsa memory list [--json]
```

Every task agent's tool: `memory_list` (reads).

#### shinsa memory write

Write a rule every agent follows, or change one with --id.

```
shinsa memory write [--id <text>] [--project <text>] <text...> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `memory.write`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `--id` | text, optional | The rule to change. Leave out to write a new one. |
| `--project` | text, optional | Only for this project (key, name or id). Leave out for every project, or with --id to keep the rule where it is. |
| `<text>` | text, required | The rule. |

#### shinsa memory keep

Keep a rule an agent proposed, so every later agent follows it.

```
shinsa memory keep <memory> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `memory.accept`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<memory>` | text, required | The memory id, from `shinsa memory list`. |

#### shinsa memory remove

Forget a rule, or dismiss one an agent proposed.

```
shinsa memory remove <memory> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it. Sends `memory.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<memory>` | text, required | The memory id, from `shinsa memory list`. |

### settings

#### shinsa settings get

Show every setting, or one.

```
shinsa settings get [<key>] [--json]
```

Every task agent's tool: `settings_get` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<key>` | text, optional | One of defaultProvider, defaultModel, maxFixRounds, delegationLimit, mergeMethod, attentionLimit, approvePlans, agentModels, agentProviders, agentFastModes, taskBudgetUsd, taskUsageLimit, autoResume, snoozeLimited, accountSwitchAt, idleCompaction, compactionLeadMinutes, compaction, fastMode, watchdogHours, watchdogFirstCheckMinutes, watchdogMaxGapHours, taskCapacity, placementPolicies. |

#### shinsa settings set

Change a setting. The value is JSON (true, 3, null, {"agent":"codex"}) or plain text.

```
shinsa settings set <key> <value...> [--json]
```

Every task agent's tool: `settings_set`. Sends `settings.change`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<key>` | text, required | One of defaultProvider, defaultModel, maxFixRounds, delegationLimit, mergeMethod, attentionLimit, approvePlans, agentModels, agentProviders, agentFastModes, taskBudgetUsd, taskUsageLimit, autoResume, snoozeLimited, accountSwitchAt, idleCompaction, compactionLeadMinutes, compaction, fastMode, watchdogHours, watchdogFirstCheckMinutes, watchdogMaxGapHours, taskCapacity, placementPolicies. Only the human changes approvePlans, mergeMethod, taskBudgetUsd, taskUsageLimit, autoResume, snoozeLimited, accountSwitchAt, fastMode, agentFastModes, delegationLimit. |
| `<value>` | text, required | The new value. |

### projects

#### shinsa projects list

List the projects, each with its key and repositories.

```
shinsa projects list [--json]
```

Every task agent's tool: `projects_list` (reads).

#### shinsa projects show

Show a project: its description, repositories and folders.

```
shinsa projects show <project> [--json]
```

Every task agent's tool: `projects_show` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |

#### shinsa projects write

Create a project, or change one with --id.

```
shinsa projects write [--id <text>] [--name <text>] [--key <text>] [--color <blue|purple|green|orange|pink|sky|amber|red>] [--description <text>] [--folders <list>] [--json]
```

Every task agent's tool: `projects_write`. Sends `project.write`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `--id` | text, optional | The project to change (key, name or id). Leave out to create one. |
| `--name` | text, optional | Its name. Needed for a new project. |
| `--key` | text, optional | The prefix of its task handles, such as SW. Derived from the name when left out. |
| `--color` | choice, optional | Its colour. |
| `--description` | text, optional | What the project is. Agents read it. |
| `--folders` | list, optional | Folders whose repositories all belong to it, replacing the ones it has. Repeat the option for each. |

#### shinsa projects remove

Remove a project. Its repositories and tasks keep working without one.

```
shinsa projects remove <project> [--json]
```

Every task agent's tool: `projects_remove`. Sends `project.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |

#### shinsa projects add-repo

Put a repository in a project, registering it if no agent has worked there yet.

```
shinsa projects add-repo <project> <path> [--json]
```

Every task agent's tool: `projects_add_repo`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |
| `<path>` | text, required | A full path, or one starting with ~/. |

#### shinsa projects add-folder

Add a folder to a project: every repository in it belongs to the project.

```
shinsa projects add-folder <project> <path> [--json]
```

Every task agent's tool: `projects_add_folder`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |
| `<path>` | text, required | A full path, or one starting with ~/. |

### focus

#### shinsa focus show

Show the project you are focused on.

```
shinsa focus show [--json]
```

Every task agent's tool: `focus_show` (reads).

#### shinsa focus set

Focus on one project: Shinsa shows only its work.

```
shinsa focus set <project> [--hours <number>] [--json]
```

Every task agent's tool: `focus_set`. Sends `focus.change`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |
| `--hours` | number, optional | Only for this many hours. |

#### shinsa focus clear

Stop focusing on one project.

```
shinsa focus clear [--json]
```

Every task agent's tool: `focus_clear`. Sends `focus.change`.

### repos

#### shinsa repos list

List the repositories agents have worked in.

```
shinsa repos list [--json]
```

Every task agent's tool: `repos_list` (reads).

#### shinsa repos update

Change a repository's name, default branch, project, check commands, where agents work or how test coverage is measured.

```
shinsa repos update <repo> [--name <text>] [--default-branch <text>] [--project <text>] [--checks <list>] [--workspace <worktrees|main_checkout>] [--coverage <auto|custom|off>] [--coverage-command <text>] [--coverage-report <text>] [--coverage-format <lcov|cobertura|go>] [--json]
```

Every task agent's tool: `repos_update`. Sends `repo.update`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<repo>` | text, required | The repository (name or id). |
| `--name` | text, optional | Its name. |
| `--default-branch` | text, optional | The branch pull requests target. |
| `--project` | text, optional | Its project (key, name or id), or none. |
| `--checks` | list, optional | The commands every task runs before review, in order, on top of the checks its agent plans. Repeat the option for each. Only the human changes them. |
| `--workspace` | choice, optional | Where agents work: worktrees (a worktree each) or main_checkout (one task at a time in the checkout). Only the human changes it. |
| `--coverage` | choice, optional | How Shinsa measures test coverage of the changed lines before review: auto (the test checks of the task, run once more with coverage), custom (yours, with --coverage-command and --coverage-report) or off. Only the human changes it. |
| `--coverage-command` | text, optional | With --coverage custom: the command that runs the tests with coverage. |
| `--coverage-report` | text, optional | With --coverage custom: the report it writes, relative to the repository. |
| `--coverage-format` | choice, optional | With --coverage custom: the report format, when its name does not tell (lcov, cobertura or go). |

#### shinsa repos remove

Forget a repository. Nothing on disk changes.

```
shinsa repos remove <repo> [--json]
```

Every task agent's tool: `repos_remove`. Sends `repo.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<repo>` | text, required | The repository (name or id). |

### folders

#### shinsa folders list

List the folders Shinsa looks in for repositories.

```
shinsa folders list [--json]
```

Every task agent's tool: `folders_list` (reads).

#### shinsa folders suggest

Find the folders on this machine that hold git repositories.

```
shinsa folders suggest [--refresh] [--json]
```

Every task agent's tool: `folders_suggest` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `--refresh` | boolean, optional | Scan again instead of using the last scan. |

#### shinsa folders add

Add a folder Shinsa looks in for repositories.

```
shinsa folders add <path> [--json]
```

Every task agent's tool: `folders_add`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<path>` | text, required | A full path, or one starting with ~/. |

#### shinsa folders remove

Stop looking in a folder for repositories.

```
shinsa folders remove <path> [--json]
```

Every task agent's tool: `folders_remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<path>` | text, required | A full path, or one starting with ~/. |

### accounts

#### shinsa accounts list

List the Claude accounts agents run on.

```
shinsa accounts list [--json]
```

Every task agent's tool: `accounts_list` (reads).

#### shinsa accounts refresh

Check every account’s sign-in and usage again.

```
shinsa accounts refresh [--json]
```

Every task agent's tool: `accounts_refresh`.

#### shinsa accounts sign-in

Sign in to a Claude account in the browser. Then pass the code with sign-in-code.

```
shinsa accounts sign-in [<account>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<account>` | text, optional | An account to sign in again (id or email). |

#### shinsa accounts sign-in-code

Finish a sign-in with the code the browser showed.

```
shinsa accounts sign-in-code <login> <code> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<login>` | text, required | The sign-in id. |
| `<code>` | text, required | The code. |

#### shinsa accounts import

Sign in to an account claude-swap has, as a login of its own.

```
shinsa accounts import <email> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<email>` | text, required | The account’s email in claude-swap. |

#### shinsa accounts update

Make an account the default, leave it out of new work, move it, or set when Shinsa switches away from it.

```
shinsa accounts update <account> [--default] [--paused] [--switch-at <integer>] [--position <integer>] [--json]
```

Every task agent's tool: `accounts_update`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<account>` | text, required | The account (id or email). |
| `--default` | boolean, optional | Make it the default. |
| `--paused` | boolean, optional | Leave it out of new work (true) or use it again (false). |
| `--switch-at` | integer, optional | Switch away at this usage percentage; 0 uses the setting. |
| `--position` | integer, optional | Its place in the list, from 0. |

#### shinsa accounts remove

Remove an account from Shinsa. Your own Claude Code login is never signed out.

```
shinsa accounts remove <account> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<account>` | text, required | The account (id or email). |

### usage

#### shinsa usage

Show how much of each usage limit every account has used, and when it resets.

```
shinsa usage [--json]
```

Every task agent's tool: `usage` (reads).

### providers

#### shinsa providers

List the agent providers and their models.

```
shinsa providers [--json]
```

Every task agent's tool: `providers` (reads).

### versions

#### shinsa versions list

Show the installed Claude Code and Codex, the latest of each and the Claude Agent SDK Shinsa runs.

```
shinsa versions list [--json]
```

Every task agent's tool: `versions_list` (reads).

#### shinsa versions update

Update Claude Code or Codex with its own updater.

```
shinsa versions update <program> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<program>` | choice, required | claude or codex. |

### terminals

#### shinsa terminals list

List your terminals in Shinsa: each one’s folder and whether its shell still runs.

```
shinsa terminals list [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

### health

#### shinsa health

Check that Shinsa loaded its log cleanly, and which Shinsa is running.

```
shinsa health [--json]
```

Every task agent's tool: `health` (reads).

### queue

#### shinsa queue

What needs a decision, and what agents are working on.

```
shinsa queue [--json]
```

Every task agent's tool: `queue` (reads).

### activity

#### shinsa activity

What agents did on your behalf, oldest first.

```
shinsa activity [--json]
```

Every task agent's tool: `activity` (reads).

### setup

#### shinsa setup status

Where setup stands, and where Shinsa keeps its data.

```
shinsa setup status [--json]
```

Every task agent's tool: `setup_status` (reads).

#### shinsa setup check

Check the tools Shinsa needs: git, gh, claude and bun.

```
shinsa setup check [--json]
```

Every task agent's tool: `setup_check` (reads).

### services

#### shinsa services list

List your services in Shinsa: what each runs, in which project, whether it is running and its preview URL.

```
shinsa services list [--project <text>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `--project` | text, optional | Only this project’s services (id, key or name). |

#### shinsa services start

Start a service in its terminal, as Start does in Shinsa.

```
shinsa services start <service> [--project <text>] [--task <text>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<service>` | text, required | The service, by its name. |
| `--project` | text, optional | The project the service belongs to, when two have one by that name. |
| `--task` | text, optional | Run it for this task, in its worktree: its handle (SW-142), id or exact title. |

#### shinsa services stop

Stop a service: its programs get a hang-up, as closing a terminal does.

```
shinsa services stop <service> [--project <text>] [--task <text>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<service>` | text, required | The service, by its name. |
| `--project` | text, optional | The project the service belongs to, when two have one by that name. |
| `--task` | text, optional | Run it for this task, in its worktree: its handle (SW-142), id or exact title. |

#### shinsa services restart

Stop a service and start it again.

```
shinsa services restart <service> [--project <text>] [--task <text>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<service>` | text, required | The service, by its name. |
| `--project` | text, optional | The project the service belongs to, when two have one by that name. |
| `--task` | text, optional | Run it for this task, in its worktree: its handle (SW-142), id or exact title. |

### mcp

#### shinsa mcp list

List the MCP servers agents can load, with their health and roughly what their tools cost.

```
shinsa mcp list [--json]
```

Every task agent's tool: `mcp_list` (reads).

#### shinsa mcp check

Connect to every MCP server that is on, or one, and list its tools.

```
shinsa mcp check [<server>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, optional | The MCP server (its id or name). |

#### shinsa mcp add

Add an MCP server agents load everywhere: a command on this machine, or an HTTP address.

```
shinsa mcp add <name> [--url <text>] [--sse] [<command...>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<name>` | text, required | Its name. |
| `--url` | text, optional | Its http or https address, for a remote server. |
| `--sse` | boolean, optional | The address speaks SSE rather than streamable HTTP. |
| `<command>` | text, optional | The command that starts it, with its arguments (after -- when one starts with --). |

#### shinsa mcp remove

Remove an MCP server you added in Shinsa.

```
shinsa mcp remove <server> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, required | The MCP server (its id or name). |

#### shinsa mcp on

Turn an MCP server on for agents.

```
shinsa mcp on <server> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, required | The MCP server (its id or name). |

#### shinsa mcp off

Turn an MCP server off for agents.

```
shinsa mcp off <server> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, required | The MCP server (its id or name). |

#### shinsa mcp sign-in

Sign in to a remote MCP server in the browser; Shinsa keeps the sign-in.

```
shinsa mcp sign-in <server> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, required | The MCP server (its id or name). |

#### shinsa mcp sign-out

Forget Shinsa’s sign-in to a remote MCP server.

```
shinsa mcp sign-out <server> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<server>` | text, required | The MCP server (its id or name). |

### skills

#### shinsa skills list

List the skills agents can load, on or off, with roughly what each costs.

```
shinsa skills list [--json]
```

Every task agent's tool: `skills_list` (reads).

#### shinsa skills on

Turn a skill on for agents.

```
shinsa skills on <skill> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<skill>` | text, required | The skill (its id or name). |

#### shinsa skills off

Turn a skill off for agents.

```
shinsa skills off <skill> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<skill>` | text, required | The skill (its id or name). |

### plugins

#### shinsa plugins list

List the Claude Code plugins agents can load, with what each brings.

```
shinsa plugins list [--json]
```

Every task agent's tool: `plugins_list` (reads).

#### shinsa plugins on

Turn a plugin on for agents.

```
shinsa plugins on <plugin> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<plugin>` | text, required | The plugin (its id or name). |

#### shinsa plugins off

Turn a plugin off for agents.

```
shinsa plugins off <plugin> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<plugin>` | text, required | The plugin (its id or name). |

### watchdogs

#### shinsa watchdogs stop

Stop a watchdog that watches a merged change.

```
shinsa watchdogs stop <task> <watchdog> [--json]
```

Every task agent's tool: `watchdogs_stop`. Sends `watchdog.stop`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<watchdog>` | text, required | The watchdog: its number in `shinsa tasks show`, from 1, or its title. |

#### shinsa watchdogs connect

Give a watchdog that waits for a data source its MCP server, and add the server to the project’s data sources.

```
shinsa watchdogs connect <task> <watchdog> --server <text> --data <text> [--json]
```

Every task agent's tool: `watchdogs_connect`. Sends `watchdog.connect`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<task>` | text, required | The task: its handle (SW-142), its id, the start of its id, or its exact title. |
| `<watchdog>` | text, required | The watchdog: its number in `shinsa tasks show`, from 1, or its title. |
| `--server` | text, required | The MCP server that holds the data, by name, as Settings → Integrations lists it. |
| `--data` | text, required | What the server holds that the check reads. |

### sources

#### shinsa sources list

List a project’s data sources: the MCP servers its agents read, and what each holds.

```
shinsa sources list <project> [--json]
```

Every task agent's tool: `sources_list` (reads).

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |

#### shinsa sources write

Add a data source to a project, or change one: an MCP server agents read, and what it holds.

```
shinsa sources write <project> --server <text> --data <text> [--repos <list>] [--json]
```

Every task agent's tool: `sources_write`. Sends `watch_source.write`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |
| `--server` | text, required | The MCP server that holds the data, by name, as Settings → Integrations lists it. |
| `--data` | text, required | What the server holds. |
| `--repos` | list, optional | The repositories it covers. Left out, every one. |

#### shinsa sources remove

Remove a data source from a project.

```
shinsa sources remove <project> --server <text> [--json]
```

Every task agent's tool: `sources_remove`. Sends `watch_source.remove`.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<project>` | text, required | The project: its key, name or id. |
| `--server` | text, required | The MCP server that holds the data, by name, as Settings → Integrations lists it. |

### remote

#### shinsa remote status

Show whether this machine can be reached from Shinsa Cloud, and its enrolled devices.

```
shinsa remote status [--json]
```

Every task agent's tool: `remote_status` (reads).

#### shinsa remote pair

Turn on remote access: sign in with GitHub in the browser to give this machine its tunnel.

```
shinsa remote pair [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote enable

Start the tunnel again after pausing it.

```
shinsa remote enable [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote disable

Pause remote access: stop the tunnel and close every open session.

```
shinsa remote disable [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote remove

Remove this machine from Shinsa Cloud and forget its tunnel and devices.

```
shinsa remote remove [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote link

Show the reusable invite link that asks for access to this machine, making it if it is off.

```
shinsa remote link [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote link-off

Turn the invite link off, so nobody can ask for access with it any more.

```
shinsa remote link-off [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

#### shinsa remote accept

Accept an access request: add its device, and make its account a member when it is not yours.

```
shinsa remote accept <request> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<request>` | text, required | The request’s id, or the GitHub login that asked, from `shinsa remote status`. |

#### shinsa remote decline

Decline an access request and forget it.

```
shinsa remote decline <request> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<request>` | text, required | The request’s id, or the GitHub login that asked, from `shinsa remote status`. |

#### shinsa remote remove-member

Take away someone’s remote access: forget the devices they added and close their open sessions.

```
shinsa remote remove-member <login> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<login>` | text, required | Their GitHub login, from `shinsa remote status`. |

#### shinsa remote forget-device

Remove an enrolled device and close its open sessions.

```
shinsa remote forget-device <device> [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<device>` | text, required | The device’s key, from `shinsa remote status`. |

### command

#### shinsa command

Send any command Shinsa understands, by its type and fields. The other commands are friendlier.

```
shinsa command <type> [--fields <json>] [--json]
```

Yours alone: no agent has a tool for it, and an agent’s shell may not run it.

| Argument | Kind | What it is |
| --- | --- | --- |
| `<type>` | choice, required | The command type. |
| `--fields` | json, optional | Its fields as a JSON object, such as {"taskId":"…"}. |
