import type { ShinsaEventInput } from '../../../packages/core/src/index.ts';
import { HOUR } from '../../kit/time.ts';
import { createPlanCheck, listSeedIterations, NOW, type SeedTask } from '../kit.ts';
import {
  CLI_PATHS,
  REGISTRY_NEW,
  SUGGEST_NEW,
  COMMAND_INDEX_NEW,
  PUSH_NEW,
  DEPLOY_NEW,
  CODEMOD_NEW,
  HELP_NEW,
  DOCS_SCRIPT_NEW,
  CLI_INDEX_NEW,
  MCP_COMMANDS_NEW,
  HELP_TEST_NEW,
} from '../sources/cli.ts';
import { TAB_GROUP_NEW, TAB_GROUP_TEST_NEW } from '../sources/kanna.ts';
import { DUPLICATE_NEW, ERRORS_NEW, DUPLICATE_TEST_NEW } from '../sources/paywall.ts';
import { spot, rangeOf, lineOf } from '../spots.ts';
import type { SeedRepos, SeedWorktrees } from '../workspace.ts';

const EXIT_CODE_CALL = 'Usage errors exit with code 2';

export function listReviewTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const duplicatePath = worktrees.duplicate;
  const tabsPath = worktrees.tabs;
  const duplicateFile = 'src/paywalls/duplicate.ts';
  const duplicateTestFile = 'src/paywalls/duplicate.test.ts';
  const errorsFile = 'src/paywalls/errors.ts';
  const tabsFile = 'src/ui/tab-group.tsx';
  const tabsTestFile = 'src/ui/tab-group.test.tsx';
  return [
    {
      id: 'task-duplicate',
      request: 'Block duplicating code-first paywalls, they should be duplicated from the repo.',
      title: 'Refuse to duplicate code-first paywalls',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_merge',
      priority: 'urgent',
      reason: 'clean and ready to merge',
      branch: 'fix/code-first-duplicate',
      findings: [],
      reviewSummary:
        'The guard covers the dashboard button and the public API, and the new test fails without it.',
      reviewRatings: { confidence: 'high', risk: 'low' },
      review: { minutes: 0, autopilot: 'High confidence, low risk, urgent.' },
      ageHours: 30,
      worktreePath: duplicatePath,
      report: {
        headline: 'Duplicating a code-first paywall now fails with a clear error.',
        sections: [
          {
            title: 'Find the duplicate path',
            summary:
              'The dashboard button and the public API both call duplicatePaywall, which copied any paywall, code-first ones included.',
            spots: [],
          },
          {
            title: 'Refuse code-first paywalls',
            summary:
              'duplicatePaywall throws a typed error for code-first paywalls, with its own error code.',
            spots: [
              spot(
                duplicateFile,
                DUPLICATE_NEW,
                'const source = await db.paywall.findUniqueOrThrow',
                'throw new PaywallError',
                'high',
                {
                  title: 'Refuse after reading the source',
                  why: 'The API maps PaywallError codes to 409; the dashboard shows the message as is.',
                  explain:
                    'The source paywall is read as before; when its `kind` is `code_first` the function throws before anything is written. Visual paywalls take the old path unchanged.',
                }
              ),
              spot(
                errorsFile,
                ERRORS_NEW,
                'export type PaywallErrorCode',
                'export class PaywallError',
                'normal',
                {
                  title: 'A code for this refusal',
                  why: 'Clients that switch on the code need a case for the new value, or they fall into their default.',
                  explain:
                    '`code_first_duplicate` joins the union, so the API layer maps it like the other codes and the dashboard can show the message instead of a generic failure.',
                }
              ),
            ],
          },
          {
            title: 'Cover both kinds with tests',
            summary: 'One test per paywall kind.',
            spots: [
              spot(
                duplicateTestFile,
                DUPLICATE_TEST_NEW,
                "it('refuses a code-first paywall'",
                'rejects.toThrow',
                'normal',
                {
                  title: 'The refusal',
                  why: 'Fails on main, passes on this branch.',
                  explain:
                    'Seeds a code-first paywall and expects the duplicate to reject with the repository message, so a regression shows up as a test failure rather than a copied paywall.',
                }
              ),
              spot(
                duplicateTestFile,
                DUPLICATE_TEST_NEW,
                "it('copies a visual paywall'",
                'expect(copy.name)',
                'normal',
                {
                  title: 'Visual paywalls still copy',
                  why: 'Only the name is checked, not the copied content.',
                  explain:
                    'The happy path stays covered: a visual paywall is copied for a new owner and gets the “(copy)” suffix.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Guard the server, not the button',
            call: 'Guarded duplicatePaywall instead of hiding the button',
            reason:
              'The dashboard, the public API and the template job all call it. One guard in the function covers every caller.',
            file: duplicateFile,
            ...rangeOf(DUPLICATE_NEW, "if (source.kind === 'code_first')", 'throw new PaywallError'),
            alternatives: [
              {
                option: 'Hide the Duplicate button for code-first paywalls',
                rejected:
                  'The API route stays open, and the next client with a duplicate action repeats the bug.',
              },
              {
                option: 'Check the kind in each route handler',
                rejected: 'Three callers would each need the same check, and a fourth would forget it.',
              },
            ],
          },
          {
            title: 'A dedicated error code',
            call: 'Added a code_first_duplicate error code',
            reason:
              'The dashboard shows PaywallError messages as they are. `forbidden` would tell the user they lack access, which is not why it failed.',
            file: errorsFile,
            ...rangeOf(ERRORS_NEW, 'export type PaywallErrorCode', 'export type PaywallErrorCode'),
            alternatives: [
              {
                option: 'Reuse forbidden',
                rejected: 'Reads as a permissions problem, and support would chase the wrong cause.',
              },
              {
                option: 'Throw a plain Error',
                rejected: 'Becomes a 500 and an alert for a request that is simply not allowed.',
              },
            ],
          },
          {
            title: 'Check the kind after the read',
            call: 'Checked the kind after the read instead of filtering in the query',
            reason:
              'Filtering in `where` would turn a code-first paywall into not found, which hides the reason.',
            file: duplicateFile,
            ...rangeOf(
              DUPLICATE_NEW,
              'const source = await db.paywall.findUniqueOrThrow',
              "if (source.kind === 'code_first')"
            ),
            alternatives: [
              {
                option: "Add `kind: { not: 'code_first' }` to the query",
                rejected:
                  'One query instead of a check, but the user would see “not found” for a paywall they are looking at.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Code-first paywalls live in a repository; the dashboard only mirrors them. Duplicating one created a dashboard copy that no repository owns, which then drifted from the code.\n\nThe fix is one guard where every duplicate starts: `duplicatePaywall` reads the source, and a code-first source throws a `PaywallError` with a new `code_first_duplicate` code and a message that says where to duplicate it instead.',
          flow: "1. The dashboard or the API calls `duplicatePaywall(paywallId, ownerId)`.\n2. The source paywall is read; a missing one still throws not found.\n3. A `code_first` source throws `PaywallError('code_first_duplicate')`.\n4. The API maps the code to 409 and returns the message; the dashboard shows it in a toast.\n5. A visual paywall is copied as before.\n\n```text\nDuplicate button ─┐\nPOST /duplicate ──┼──▶ duplicatePaywall(paywallId, ownerId)\ntemplate job ─────┘          │\n                             ▼\n                       read the source ── missing ──▶ not found\n                             │\n                             ▼\n                       code_first? ── yes ──▶ PaywallError (409)\n                             │ no                  │\n                             ▼                     ▼\n                  db.paywall.create(copy)    toast in the dashboard\n```",
          risks: [
            {
              title: 'Existing copies stay as they are',
              risk: 'Copies made from code-first paywalls before this change still exist and behave like visual paywalls nobody maintains. They are not touched here.',
              file: null,
              line: null,
              end: null,
            },
            {
              title: 'Old dashboards show a generic error',
              risk: 'Older dashboard builds switch on the error code and have no case for `code_first_duplicate`, so they show the generic “Something went wrong” until they update.',
              file: errorsFile,
              ...rangeOf(ERRORS_NEW, 'export type PaywallErrorCode', 'export type PaywallErrorCode'),
            },
          ],
          testing: {
            automated: [
              '`duplicate.test.ts` covers both kinds: a visual paywall is copied, a code-first one is refused with the repository message.',
            ],
            manual: [
              {
                action: 'Run the duplicate tests on the branch.',
                target: { kind: 'command', value: 'bun test src/paywalls/duplicate.test.ts' },
                expect: 'Both cases pass: the visual copy and the refused code-first paywall.',
              },
              {
                action: 'Start the dashboard and open the paywall list.',
                target: { kind: 'url', value: 'http://localhost:5173/paywalls' },
                expect: 'The list loads with both visual and code-first paywalls.',
              },
              {
                action: 'Open a code-first paywall and press Duplicate.',
                target: null,
                expect:
                  'A toast says code-first paywalls are duplicated from their repository, and no copy appears in the list.',
              },
              {
                action: 'Duplicate a visual paywall the same way.',
                target: null,
                expect: 'A copy named “… (copy)” appears at the top of the list, as before.',
              },
              {
                action: 'Call the API directly for a code-first paywall.',
                target: {
                  kind: 'command',
                  value: 'curl -i -X POST http://localhost:8787/paywalls/pw_code_first/duplicate',
                },
                expect: 'A 409 with `code_first_duplicate` and the same message as the toast.',
              },
              {
                action: 'Read the guard where every duplicate starts.',
                target: {
                  kind: 'file',
                  value: `${duplicateFile}:${lineOf(DUPLICATE_NEW, "if (source.kind === 'code_first')")}-${lineOf(DUPLICATE_NEW, "throw new PaywallError('code_first_duplicate'")}`,
                },
                expect: 'The check runs before the copy is written, so the template job is covered too.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'env',
              title: 'Set `CODE_FIRST_DOCS_URL` on the API in production',
              detail:
                'The refusal message links to it. Use `https://docs.superwall.com/paywalls/code-first#duplicate`; without it the message links to the docs home.',
              command:
                'railway variables --service api --environment production --set CODE_FIRST_DOCS_URL=https://docs.superwall.com/paywalls/code-first#duplicate',
            },
            {
              when: 'pre_merge',
              kind: 'config',
              title: 'Add `code_first_duplicate` to the API error alerts allowlist',
              detail:
                'In Sentry, project `api`: a 409 with this code is expected, so it should not page anyone.',
              command: null,
            },
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Release the dashboard',
              detail:
                'Older dashboard builds show “Something went wrong” for the new code until they update; this release shows the message.',
              command: 'bun run --cwd apps/dashboard release',
            },
          ],
        },
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 9, summary: 'Added the guard and tests.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
        {
          role: 'agent',
          purpose: 'fix',
          fix: 'pull_request',
          minutes: 3,
          summary: 'Fixed the review-bot comment on #4531.',
        },
      ],
      pullRequest: {
        number: 4531,
        checks: 'passing',
        ciRuns: [
          {
            name: 'lint',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91822',
          },
          {
            name: 'check-types',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91822',
          },
          {
            name: 'test (ubuntu)',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91823',
          },
          {
            name: 'test (macos)',
            status: 'success',
            required: false,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91823',
          },
          {
            name: 'Vercel preview',
            status: 'success',
            required: false,
            url: 'https://vercel.com/superwall/paywall-next',
          },
        ],
      },
      ticked: ['Set `CODE_FIRST_DOCS_URL` on the API in production'],
      gate: {
        type: 'merge',
        title: 'Merge #4531',
        body: 'Checks are green and the review-bot comment is resolved.',
      },
      extra: [
        {
          type: 'task.escalated',
          taskId: 'task-duplicate',
          reason: 'Urgent, and the merge waited 60 minutes for you. A pre-merge step is not ticked yet.',
          handoff: {
            waitedMinutes: 60,
            ownerActiveAt: NOW - 7 * HOUR,
            foundBy: { server: 'cloudflare', shippedTaskTitle: 'Duplicate a paywall from its menu' },
            ratings: { confidence: 'high', risk: 'low' },
            mergesAt: null,
            blockedBy: 'pre_merge_steps',
          },
        },
      ],
    },
    {
      id: 'task-command-registry',
      request: 'Rewrite the framework command registry so commands declare their own args and help text.',
      title: 'Rewrite the framework command registry',
      repo: paywall,
      size: 'large',
      planFirst: true,
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'refactor/command-registry',
      ageHours: 5,
      checkResults: {
        c1: {
          detail: 'src/cli/help.test.ts timed out under load and passed when re-run alone.',
          note: 'passed_alone',
        },
      },
      worktreePath: worktrees.registry,
      plan: {
        goal: 'Every framework command declares its arguments and help text in one place, so the CLI, the docs and the agents read the same definition.',
        phases: [
          {
            title: 'Define the command schema',
            detail: 'One declaration for arguments, flags and help text.',
          },
          {
            title: 'Port the existing commands',
            detail: 'Move every command onto the schema without changing behaviour.',
          },
          {
            title: 'Generate docs and help',
            detail: 'The CLI help and the docs page read the same definition.',
          },
          { title: 'Expose it to agents', detail: 'The MCP server lists commands from the schema.' },
          { title: 'Verify every command', detail: 'Snapshot the help output and run each command once.' },
        ],
        behaviour: [
          '`superwall help <command>` prints generated help.',
          'Unknown flags fail with the closest suggestion.',
          'The docs page for each command is generated from its definition.',
        ],
        approach:
          'Introduce defineCommand({ name, args, flags, run }) and migrate all 31 commands in this task. A codemod handles the commands with plain flags; the ones that read positional arguments or stdin are done by hand. The old flag parser stays behind an opt-in variable until the next release.',
        files: [
          { path: 'src/cli/registry.ts', change: 'New defineCommand, flag builders and the parser.' },
          { path: 'src/cli/commands/*.ts', change: 'Migrated to defineCommand.' },
          { path: 'src/cli/help.ts', change: 'New: help rendered from a definition.' },
          { path: 'scripts/generate-command-docs.ts', change: 'New: one docs page per command.' },
          { path: 'src/mcp/commands.ts', change: 'New: commands listed as MCP tools.' },
        ],
        outOfScope: ['Changing any command’s behaviour.'],
        verification: [
          createPlanCheck('CLI help and flags', 'bun test src/cli', [1, 2, 3, 5]),
          createPlanCheck('Commands as MCP tools', 'bun test src/mcp/commands.test.ts', [4, 5]),
          createPlanCheck('Docs generator types', 'bunx tsc --noEmit -p scripts', [3]),
        ],
        questions: [],
      },
      report: {
        headline:
          'All 31 framework commands now declare their arguments, flags and help in one defineCommand call, and the CLI help, the docs pages and the MCP tool list are generated from it.',
        sections: [
          {
            title: 'Define the command schema',
            summary:
              'registry.ts adds defineCommand, small flag builders and parseInput, which rejects unknown flags and suggests the closest one.',
            spots: [
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                'export const flag = {',
                "number: createFlag('number'),",
                'normal',
                {
                  title: 'Flag builders',
                  why: 'Every command’s flags go through these three builders; the kind decides how parseInput reads the value.',
                  explain:
                    '`flag.string`, `flag.boolean` and `flag.number` return a `FlagSpec` with its kind, help text and optional `alias` and `default`. The generic keeps the default typed, so `flag.number(..., { default: 120 })` will not accept a string.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                'export function defineCommand',
                'return definition as unknown as CommandDefinition;',
                'high',
                {
                  title: 'One command, typed inside, plain outside',
                  why: 'The cast drops the per-command flag types once the definition leaves the file.',
                  explain:
                    'Inside a command file `run` sees `flags.wait` as `number | undefined`. The return value is widened to the plain `CommandDefinition` so 31 differently typed commands fit in one `COMMANDS` array.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                "const [raw = '', inline] = token",
                'if (!spec) throw new UsageError',
                'critical',
                {
                  title: 'Split a flag from its value',
                  why: '`split` with a limit drops everything after the second `=`, so values containing `=` are cut.',
                  explain:
                    'A token like `--app=demo` is split into the flag name and an inline value. The name goes through the alias lookup, and a name the command does not declare is a `UsageError` instead of being passed through, which is what the old parser did.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                "if (spec.kind === 'boolean') {",
                "flags[name] = spec.kind === 'number'",
                'critical',
                {
                  title: 'Read the value by kind',
                  why: 'There is no branch for `--no-<flag>`, which the old parser supported.',
                  explain:
                    'Booleans take no value: `--json` is true and `--json=false` is false. Strings and numbers take the inline value or the next token, and a missing one is a usage error naming the flag.',
                }
              ),
              spot(
                CLI_PATHS.suggest,
                SUGGEST_NEW,
                'for (const name of names)',
                'if (distance <= MAX_DISTANCE',
                'normal',
                {
                  title: 'Suggest the closest flag',
                  why: 'Two edits is tight: `--no-cache` against `cache` is three, so it gets no suggestion.',
                  explain:
                    '`suggestName` counts edits between the typed name and every declared flag and keeps the closest one within two edits. `--apps` suggests `--app`; `--frobnicate` suggests nothing.',
                }
              ),
            ],
          },
          {
            title: 'Port the existing commands',
            summary:
              'A codemod moved the 28 commands with plain flags onto defineCommand; deploy, login and logs were ported by hand.',
            spots: [
              spot(CLI_PATHS.commands, COMMAND_INDEX_NEW, 'export const COMMANDS', '  campaigns,', 'normal', {
                title: 'Every command in one list',
                why: 'A command that is not imported here does not exist: no help, no docs page, no tool.',
                explain:
                  '`COMMANDS` is a plain array of the 31 default exports, sorted by name. The CLI, the docs script and the MCP server all read this list, so they cannot disagree about what exists.',
              }),
              spot(
                CLI_PATHS.push,
                PUSH_NEW,
                'cache: flag.boolean(',
                'run: ({ flags }) => runPush(flags),',
                'critical',
                {
                  title: 'Defaults carried over from the old parser',
                  why: '`cache` defaults to true and the only way to turn it off was `--no-cache`, which the new parser rejects.',
                  explain:
                    'The codemod read the old `parseFlags` options and wrote one builder call per flag, keeping `default: { cache: true }` as `{ default: true }`. `run` receives the parsed flags as they are.',
                }
              ),
              spot(
                CLI_PATHS.deploy,
                DEPLOY_NEW,
                "args: [{ name: 'environment'",
                'run: ({ args, flags }) => runDeploy',
                'high',
                {
                  title: 'Positional arguments are declared too',
                  why: 'The `staging` fallback can never apply now that the argument is required, so it only hides a mistake.',
                  explain:
                    '`deploy` takes the environment as an argument. Declaring it makes the help show `<environment>` and lets `parseInput` fail early with “deploy needs <environment>.” instead of the action throwing later.',
                }
              ),
              spot(
                CLI_PATHS.codemod,
                CODEMOD_NEW,
                'if (!parse?.[1] || !action',
                'const options = Function(',
                'high',
                {
                  title: 'Port only what the codemod understands',
                  why: '`Function` evaluates the options object from the source. Safe here because it runs once on our own files, never on input.',
                  explain:
                    'A command is rewritten only when it has one `parseFlags(argv, {...})` call, passes `flags` straight to its action and never reads positional `flags._`. Anything else is skipped with a warning and was ported by hand.',
                }
              ),
            ],
          },
          {
            title: 'Generate docs and help',
            summary:
              'help.ts renders usage and flags from a definition; the docs script writes one page per visible command; the CLI prints help before parsing.',
            spots: [
              spot(
                CLI_PATHS.help,
                HELP_NEW,
                'for (const [name, spec] of flags)',
                'lines.push(`  ',
                'normal',
                {
                  title: 'Help from the definition',
                  why: 'Help is aligned by padding names, so a very long flag name widens every line.',
                  explain:
                    'Each flag becomes one line: the short alias if any, the name padded to the longest one, the help text and the default. Commands without flags print usage and the summary only.',
                }
              ),
              spot(
                CLI_PATHS.docs,
                DOCS_SCRIPT_NEW,
                'for (const command of visible)',
                'writeFileSync(join(OUT, `',
                'normal',
                {
                  title: 'One docs page per command',
                  why: 'Pages are only written, never removed.',
                  explain:
                    'The page is the command name, its summary and the same help text the CLI prints, in a code block. The script runs in the docs build, so the pages cannot drift from the CLI.',
                }
              ),
              spot(
                CLI_PATHS.index,
                CLI_INDEX_NEW,
                "if (name === 'help'",
                "if (rest.includes('--help'))",
                'normal',
                {
                  title: 'Help before parsing',
                  why: '`--help` anywhere in the arguments wins, even as the value of a string flag.',
                  explain:
                    '`superwall help deploy` and `superwall deploy --help` print the same text. Help is checked before `parseInput`, so asking for help never fails on a missing argument.',
                }
              ),
            ],
          },
          {
            title: 'Expose the commands to agents',
            summary:
              'The MCP server lists every visible command as a tool, with an input schema built from its flags.',
            spots: [
              spot(
                CLI_PATHS.mcp,
                MCP_COMMANDS_NEW,
                'return COMMANDS.filter',
                'inputSchema: resolveInputSchema(command),',
                'high',
                {
                  title: 'Commands become tools',
                  why: 'Every visible command, including deploy and rollback, is offered to agents unless it sets `agents: false`.',
                  explain:
                    'Each command becomes a tool named `superwall.<command>` with its summary as the description. `hidden` commands and those marked `agents: false` (login, for its token) are left out.',
                }
              ),
              spot(
                CLI_PATHS.mcp,
                MCP_COMMANDS_NEW,
                'if (args.length > 0) {',
                "return { type: 'object', properties",
                'normal',
                {
                  title: 'Arguments as one array',
                  why: 'The array has no `items`, which strict JSON schema validators reject.',
                  explain:
                    'Flags map one to one onto properties, using the flag kind as the JSON type. Positional arguments become one `args` array described by their names, required when any argument is.',
                }
              ),
            ],
          },
          {
            title: 'Verify every command',
            summary:
              'A snapshot of every command’s help, a check that no flag lacks help text, and two parser tests.',
            spots: [
              spot(
                CLI_PATHS.test,
                HELP_TEST_NEW,
                'for (const command of COMMANDS)',
                'toMatchSnapshot',
                'normal',
                {
                  title: 'A snapshot per command',
                  why: 'Snapshots show the help changed, not that the parsing behaves as before.',
                  explain:
                    'One test per command renders its help and compares it with the stored snapshot, so any change to a flag, default or summary shows up in review as a snapshot diff.',
                }
              ),
              spot(
                CLI_PATHS.test,
                HELP_TEST_NEW,
                "it('gives every flag a help text'",
                'expect(missing).toEqual([]);',
                'normal',
                {
                  title: 'No flag without help',
                  why: 'The codemod writes an empty string when `flag-help.json` has no entry; this test is what catches it.',
                  explain:
                    'Collects every `command --flag` pair whose help is empty and expects none. The failure message lists them, which is how the four missing texts were found during the port.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'A static command list',
            call: 'A static list of commands instead of scanning the folder',
            reason:
              'The CLI ships as one bundle, so a folder scan at runtime finds nothing. An import per command is 31 lines and makes the list explicit.',
            file: CLI_PATHS.commands,
            ...rangeOf(COMMAND_INDEX_NEW, 'export const COMMANDS', 'export const COMMANDS'),
            alternatives: [
              {
                option: 'Glob src/cli/commands at startup',
                rejected:
                  'The bundled CLI has no commands folder, and reading files on every start slows `superwall --help`.',
              },
              {
                option: 'Register from each command file as a side effect',
                rejected:
                  'Order would depend on import order, and a file nobody imports would silently drop its command.',
              },
            ],
          },
          {
            title: 'Own flag builders, no zod',
            call: 'Wrote small flag builders instead of using zod',
            reason:
              'The schema needs help text, aliases and positional arguments as much as types. Three builders cover that in 15 lines and keep the CLI start fast.',
            file: CLI_PATHS.registry,
            ...rangeOf(REGISTRY_NEW, 'export const flag = {', "number: createFlag('number'),"),
            alternatives: [
              {
                option: 'zod schemas with describe() for help',
                rejected:
                  'Aliases and positional arguments would sit outside the schema anyway, and it adds a dependency to every CLI start.',
              },
              {
                option: 'commander or yargs',
                rejected:
                  'They own parsing, dispatch and help, so the docs and the MCP list would have to read their internals.',
              },
            ],
          },
          {
            title: 'Codemod most commands',
            call: 'Codemod for 28 commands, 3 ported by hand',
            reason:
              'Most commands pass their flags straight to an action, which a regex can read reliably. deploy, login and logs do more and needed a person.',
            file: CLI_PATHS.codemod,
            ...rangeOf(CODEMOD_NEW, 'if (!parse?.[1] || !action', 'console.warn(`Skipped'),
            alternatives: [
              {
                option: 'Port all 31 by hand',
                rejected: 'A day of identical edits, with typos the snapshots would only partly catch.',
              },
              {
                option: 'Codemod everything with a TypeScript AST',
                rejected: 'More code than the three commands it would save, and it would run once.',
              },
            ],
          },
          {
            title: 'Keep the old parser behind a flag',
            call: 'Kept the old parser behind SUPERWALL_LEGACY_FLAGS=1',
            reason:
              'You asked to keep it during the migration. Opting in with a variable keeps one parser in charge by default.',
            file: CLI_PATHS.index,
            ...rangeOf(
              CLI_INDEX_NEW,
              'const legacy = env.SUPERWALL_LEGACY_FLAGS',
              'await command.run(legacy'
            ),
            alternatives: [
              {
                option: 'Retry with the old parser when the new one throws',
                rejected: 'Typos would be accepted again, and the same command line could mean two things.',
              },
            ],
          },
          {
            title: 'Exit code 2 for usage errors',
            call: EXIT_CODE_CALL,
            reason:
              'Scripts can then tell a typo from a failed deploy. 2 is what most CLIs use for usage errors.',
            file: CLI_PATHS.index,
            ...rangeOf(CLI_INDEX_NEW, 'function fail(message: string', 'process.exit(2);'),
            alternatives: [
              {
                option: 'Keep exit code 1 for everything',
                rejected:
                  'A CI step cannot tell “wrong flag” from “the deploy failed” without parsing stderr.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Before this change each command parsed its own `argv` with `parseFlags`, which accepted any flag, and the help and the docs were written by hand. Now each command file exports one `defineCommand({ name, summary, args, flags, run })`, and everything else reads that definition.\n\n`registry.ts` holds the types, the flag builders and `parseInput`. `commands/index.ts` lists all 31 commands. The CLI entry, `help.ts`, the docs script and the MCP server read that list.\n\nThe port ran in two passes: a codemod rewrote the 28 commands that pass their flags straight to an action, and deploy, login and logs were ported by hand. Behaviour stayed the same except where the old parser was lax: unknown flags now fail with a suggestion.',
          flow: '1. `main(argv)` takes the command name. `help`, `--help` and unknown names print help without parsing.\n2. The command is looked up in `BY_NAME`, built once from `COMMANDS`.\n3. `parseInput` fills defaults, then walks the tokens: plain tokens are arguments, `--name` and `--name=value` are flags, aliases resolve through `alias`.\n4. An undeclared flag throws a `UsageError` with the closest declared name, if one is within two edits.\n5. Required arguments are checked, then `run({ args, flags })` is called.\n6. A `UsageError` prints the message and the command’s help and exits with 2; any other error propagates as before.\n\n```text\ncommands/*.ts ── defineCommand ──▶ COMMANDS\n                                      │\n        ┌─────────────────────────────┼─────────────────────┐\n        ▼                             ▼                     ▼\ncli/index.ts                help.ts, docs script     mcp/commands.ts\nparseInput ──▶ run          --help, cli/*.mdx        superwall.<name>\n```\n\nWith `SUPERWALL_LEGACY_FLAGS=1`, step 3 uses the old `parseFlags` instead and steps 4 and 5 are skipped.',
          risks: [
            {
              title: 'Short flags do not combine',
              risk: 'Short flags cannot be combined: `-fv` is looked up as one flag named `fv` and fails. Only `logs -f` and `deploy -m` have short forms today.',
              file: CLI_PATHS.registry,
              ...rangeOf(REGISTRY_NEW, "const [raw = '', inline] = token", 'const name = resolveFlagName'),
            },
            {
              title: 'Bad numbers become NaN',
              risk: 'Number flags are read with `Number()`, so `--wait soon` becomes `NaN` instead of a usage error.',
              file: CLI_PATHS.registry,
              ...rangeOf(
                REGISTRY_NEW,
                'const value = inline ?? argv[++index];',
                "flags[name] = spec.kind === 'number'"
              ),
            },
            {
              title: 'Stale pages for removed commands',
              risk: 'The docs script only writes pages. A renamed or removed command leaves its old page in `docs/cli` until someone deletes it.',
              file: CLI_PATHS.docs,
              ...rangeOf(DOCS_SCRIPT_NEW, 'mkdirSync(OUT', 'for (const command of visible)'),
            },
            {
              title: 'Agents can deploy unconfirmed',
              risk: '`deploy`, `promote` and `rollback` are offered to agents as tools with no confirmation of their own; only the MCP client’s approval stands between an agent and production.',
              file: CLI_PATHS.mcp,
              ...rangeOf(MCP_COMMANDS_NEW, 'return COMMANDS.filter', 'name: `superwall.'),
            },
            {
              title: 'Legacy mode hides the new errors',
              risk: 'With `SUPERWALL_LEGACY_FLAGS=1` unknown flags are accepted silently again, so a script that sets it never sees the new errors.',
              file: CLI_PATHS.index,
              ...rangeOf(
                CLI_INDEX_NEW,
                'const legacy = env.SUPERWALL_LEGACY_FLAGS',
                'await command.run(legacy'
              ),
            },
          ],
          testing: {
            automated: [
              '`help.test.ts` snapshots the help of all 31 commands and fails when any flag has no help text.',
              'Two parser tests: an unknown flag suggests the closest one, and `deploy` without an environment asks for it.',
            ],
            manual: [
              {
                action: 'Run a command with a misspelled flag from the worktree.',
                target: { kind: 'command', value: 'bun src/cli/index.ts push --apps demo' },
                expect: 'The CLI stops with “Did you mean --app?” instead of pushing.',
              },
              {
                action: 'Run deploy without an environment.',
                target: { kind: 'command', value: 'bun src/cli/index.ts deploy' },
                expect: 'It asks for `<environment>` and exits without building anything.',
              },
              {
                action: 'Print the help for every command.',
                target: { kind: 'command', value: 'bun src/cli/index.ts --help' },
                expect: 'All 31 commands are listed, each with a one-line summary and no empty flag help.',
              },
              {
                action: 'Generate the command docs and compare them with the hand-written pages.',
                target: {
                  kind: 'command',
                  value: 'bun scripts/generate-command-docs.ts && git diff --stat docs/cli',
                },
                expect: 'Only wording differences, and every command and flag still has a page entry.',
              },
              {
                action: 'Read how the MCP server builds its tool list from the registry.',
                target: { kind: 'file', value: CLI_PATHS.mcp },
                expect: '`login` is left out, and `deploy` gets an `args` property from its definition.',
              },
            ],
          },
        },
      },
      reviewRatings: { confidence: 'medium', risk: 'medium' },
      reviewSummary:
        'I read the registry, the parser, the codemod and a sample of the ported commands, ran every command’s help, and tried the flags used in the docs. The structure is sound; the parser drops two things the old one handled, negated flags and values containing =.',
      reviewDisagreements: [
        {
          call: EXIT_CODE_CALL,
          reason:
            'The plan kept behaviour changes out of scope, and the CI examples in the docs check for exit code 1. Changing it is reasonable but belongs in its own task with a release note.',
        },
      ],
      findings: [
        {
          severity: 'blocking',
          file: CLI_PATHS.registry,
          ...rangeOf(REGISTRY_NEW, "if (spec.kind === 'boolean') {", "flags[name] = inline !== 'false';"),
          title: 'Negated flags no longer work',
          message:
            'The old parser read `--no-cache` as `cache: false`. parseInput has no `no-` branch, so `superwall push --no-cache`, which the deploy guide uses, fails as an unknown flag, with no suggestion.',
          fix: "Accept the negated form of boolean flags before the lookup:\n\n```ts\nconst negated = raw.startsWith('no-') && command.flags[raw.slice(3)]?.kind === 'boolean';\nif (negated) {\n  flags[raw.slice(3)] = false;\n  continue;\n}\n```",
        },
        {
          severity: 'blocking',
          file: CLI_PATHS.registry,
          ...rangeOf(REGISTRY_NEW, "const [raw = '', inline] = token", "const [raw = '', inline] = token"),
          title: 'Values containing = are cut',
          message:
            "`split('=', 2)` drops everything after the second `=`, so `env-set --value=c2VjcmV0==` stores `c2VjcmV0`. Base64 values end in `=`, so this corrupts real secrets without an error.",
          fix: "Split on the first `=` only:\n\n```ts\nconst body = token.replace(/^--?/, '');\nconst at = body.indexOf('=');\nconst raw = at < 0 ? body : body.slice(0, at);\nconst inline = at < 0 ? undefined : body.slice(at + 1);\n```",
        },
        {
          severity: 'should_fix',
          file: CLI_PATHS.mcp,
          ...rangeOf(MCP_COMMANDS_NEW, 'properties.args = {', 'properties.args = {'),
          title: 'The args schema has no items',
          message:
            '`args` is declared as an array without `items`. Strict MCP clients validate every tool schema and drop the whole list over one invalid entry.',
          fix: "Declare the item type: `{ type: 'array', items: { type: 'string' }, description }`.",
        },
      ],
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 8,
          summary: 'Proposed the registry plan; you chose to port all 31 commands.',
        },
        {
          role: 'agent',
          purpose: 'build',
          minutes: 58,
          summary: 'Built the registry and ported all 31 commands.',
        },
        {
          role: 'reviewer',
          minutes: 6,
          summary: 'Two blocking findings in the flag parser, one suggestion.',
        },
      ],
      gate: {
        type: 'review',
        title: 'Review the command registry rewrite',
        body: 'Built, checked and reviewed by an agent. Two blocking findings and one suggestion left for you to judge.',
      },
    },
    {
      id: 'task-tab-scroll',
      request: 'tab groups dont scroll horizontally when there are too many tabs',
      title: 'Scroll tab groups horizontally',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'fix/tab-group-scroll',
      ageHours: 3,
      verification: [createPlanCheck('Tab group scrolling', 'bun test src/ui/tab-group.test.tsx', [1, 2, 3])],
      checkResults: { c1: { detail: '2 tests, both new' } },
      worktreePath: tabsPath,
      report: {
        headline: 'Tab groups scroll sideways and keep the active tab in view.',
        sections: [
          {
            title: 'Find why the tabs overflow',
            summary:
              'The row was a plain flex container, so extra tabs shrank until their labels clipped, then overflowed the panel.',
            spots: [
              spot(
                tabsFile,
                TAB_GROUP_NEW,
                'data-active={tab.id === active}',
                "className='shrink-0'",
                'normal',
                {
                  title: 'Tabs keep their width',
                  why: 'Without `shrink-0` the flex row squeezes every tab before it ever scrolls.',
                  explain:
                    'Flex items shrink by default. `shrink-0` keeps each tab at its label’s width, so a crowded group overflows the row instead of clipping the labels.',
                }
              ),
            ],
          },
          {
            title: 'Scroll the row',
            summary:
              'The row scrolls horizontally with the scrollbar hidden, and selecting a tab scrolls it to the centre.',
            spots: [
              spot(tabsFile, TAB_GROUP_NEW, '<div ref={listRef}', '{tabs.map((tab) => (', 'normal', {
                title: 'The row scrolls, the page does not',
                why: 'Hidden scrollbar: there is no visual hint more tabs exist off-screen.',
                explain:
                  '`overflow-x-auto` makes the row scroll, `overscroll-x-contain` stops a trackpad swipe at the end from going back in history, and `[scrollbar-width:none]` hides the bar.',
              }),
              spot(tabsFile, TAB_GROUP_NEW, 'React.useEffect', '}, [active]);', 'high', {
                title: 'Scroll the active tab into view',
                why: 'Smooth scrolling runs on first render too, so the row animates on page load.',
                explain:
                  'Whenever `active` changes, the effect finds the selected button by `data-active` and calls `scrollIntoView` with `inline: center`. `block: nearest` keeps the page from scrolling vertically to reach the row.',
              }),
            ],
          },
          {
            title: 'Test it',
            summary: 'Two component tests with 40 tabs.',
            spots: [
              spot(
                tabsTestFile,
                TAB_GROUP_TEST_NEW,
                "it('scrolls the active tab to the centre'",
                'expect(scrollIntoView).toHaveBeenLastCalledWith',
                'normal',
                {
                  title: 'Selecting a tab scrolls it',
                  why: 'jsdom has no layout, so the test checks the call, not where the row ends up.',
                  explain:
                    'Replaces `scrollIntoView` with a mock, renders 40 tabs, selects tab 31 and checks the last call asked for the centre.',
                }
              ),
              spot(
                tabsTestFile,
                TAB_GROUP_TEST_NEW,
                "it('keeps every tab at its natural width'",
                "tab.classList.contains('shrink-0')",
                'normal',
                {
                  title: 'No tab can shrink',
                  why: 'A class check: it fails if the class is removed, not if another class overrides it.',
                  explain: 'Renders 40 tabs and checks that every button keeps `shrink-0`.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Centre the active tab',
            call: 'Centred the active tab instead of scrolling it just into view',
            reason:
              'Centring shows the tabs on both sides of the selection, so you can see there is more in either direction.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, 'selected?.scrollIntoView', 'selected?.scrollIntoView'),
            alternatives: [
              {
                option: "inline: 'nearest'",
                rejected:
                  'The tab lands flush with the edge, so the next one is always hidden and the row looks like it ends there.',
              },
            ],
          },
          {
            title: 'Hide the scrollbar',
            call: 'Hid the scrollbar',
            reason:
              'The tab row is 32px tall. A horizontal scrollbar either covers the labels or adds a strip under the row, depending on the system setting.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            alternatives: [
              {
                option: 'Keep the native scrollbar',
                rejected:
                  'Overlaps the labels on macOS with scrollbars always shown, and looks different on every system.',
              },
              {
                option: 'Fade the edges with a mask',
                rejected:
                  'Needs the scroll position in state to drop the fade at either end; worth its own change.',
              },
            ],
          },
          {
            title: 'Scroll from an effect',
            call: 'Scrolled from an effect on active, not in the click handler',
            reason:
              'Tabs are also selected by keyboard shortcuts and from links, which never pass through `onClick`.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, 'React.useEffect', '}, [active]);'),
            alternatives: [
              {
                option: 'Call scrollIntoView in onClick',
                rejected: 'Misses every selection that does not come from a click.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Two small changes in `TabGroup`. The row becomes a horizontal scroll container and the tabs stop shrinking, so a crowded group scrolls instead of squeezing its labels. Then an effect keeps the selected tab visible by scrolling it to the centre whenever the selection changes.\n\nNo state is added: the selected tab is found in the DOM through the `data-active` attribute the buttons already had.',
          flow: "1. The row renders with `overflow-x-auto`, and each tab keeps its width with `shrink-0`.\n2. With more tabs than fit, the row scrolls under a trackpad swipe or Shift with the wheel.\n3. When `active` changes, from a click, a shortcut or a link, the effect runs.\n4. It looks up `[data-active=\"true\"]` inside the row and scrolls it to the centre.\n\n```text\nclick, shortcut or link\n  │ onSelect(id)\n  ▼\nparent sets active ──▶ TabGroup renders the row\n  │                    overflow-x-auto, every tab shrink-0\n  ▼\nuseEffect([active])\n  │\n  ▼\nlistRef.current.querySelector('[data-active=\"true\"]')\n  │\n  ▼\nscrollIntoView({ block: 'nearest', inline: 'center' })\n```",
          risks: [
            {
              title: 'Hidden tabs give no hint',
              risk: 'Without a scrollbar or a fade, nothing shows that more tabs exist off-screen.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            },
            {
              title: 'Vertical wheels need Shift',
              risk: 'A mouse with only a vertical wheel cannot scroll the row unless Shift is held.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            },
            {
              title: 'The page can scroll too',
              risk: '`scrollIntoView` also scrolls scrollable ancestors. `block: nearest` keeps that to a minimum, but a page scrolled away from the row can still move.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, 'selected?.scrollIntoView', 'selected?.scrollIntoView'),
            },
          ],
          testing: {
            automated: [
              '`tab-group.test.tsx` checks that selecting a tab scrolls it to the centre and that no tab can shrink.',
            ],
            manual: [
              {
                action: 'Open the preview deployment of this branch on a paywall with many tabs.',
                target: {
                  kind: 'url',
                  value: 'https://paywall-editor-git-fix-tab-group-scroll.vercel.app/paywalls/spring-sale',
                },
                expect: 'The tab row runs past the edge and scrolls sideways instead of squeezing the tabs.',
              },
              {
                action: 'Open a group with 40 tabs and select the last one.',
                target: null,
                expect: 'The row scrolls the selected tab to the middle and every tab keeps its full width.',
              },
              {
                action: 'Scroll the row with a vertical mouse wheel, then again with Shift held.',
                target: null,
                expect: 'Only the Shift scroll moves the row; this is the known limit in the risks.',
              },
              {
                action: 'Reload the page while a late tab is selected and watch the row.',
                target: null,
                expect: 'The row starts at the selected tab without sliding into place on load.',
              },
              {
                action: 'Read the scroll call to see why the page around the row can move.',
                target: {
                  kind: 'file',
                  value: `${tabsFile}:${lineOf(TAB_GROUP_NEW, 'selected?.scrollIntoView')}`,
                },
                expect: '`block: nearest` keeps the page still unless the row is already off screen.',
              },
            ],
          },
        },
      },
      reviewSummary:
        'I read the scroll change and opened a group with 40 tabs. The row scrolls and keeps the active tab in view; the only issue is the animation on first render.',
      findings: [
        {
          severity: 'optional',
          file: 'src/ui/tab-group.tsx',
          line: lineOf(TAB_GROUP_NEW, "behavior: 'smooth'"),
          title: 'The row animates on page load',
          message:
            'The effect scrolls smoothly on mount too, so a page that opens on a later tab slides the whole row into place.',
          fix: "Scroll instantly on the first render and smoothly only after a selection, for example with a ref that records the first run:\n\n```ts\nconst behavior = mounted.current ? 'smooth' : 'instant';\nmounted.current = true;\n```",
        },
      ],
      runs: [
        { role: 'agent', purpose: 'build', minutes: 7, summary: 'Made the row scrollable.' },
        { role: 'reviewer', minutes: 2, summary: 'One suggestion.' },
      ],
      extra: listTabScrollIterations(),
      gate: {
        type: 'review',
        title: 'Review the tab group scroll fix',
        body: 'Small fix, one suggestion from the agent review.',
      },
    },
  ];
}

function listTabScrollIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-tab-scroll', 'task-tab-scroll-run-0', [
    {
      text: "With the scrollbar hidden I can't tell there are more tabs. Can we show that somehow? And does this work with the arrow keys?",
      reply: {
        headline:
          'The row now fades at an edge while more tabs sit past it, and the arrow keys move between tabs.',
        points: [
          {
            ask: 'Show that there are more tabs',
            outcome: 'done',
            note: 'A fade at each edge that has tabs beyond it; it goes once you reach the end.',
          },
          {
            ask: 'Does it work with the arrow keys?',
            outcome: 'answered',
            note: 'It did not. Left and right now move the selection and scroll the new tab into view.',
          },
        ],
        next: null,
      },
    },
    {
      text: 'The active tab disappears when I make the window narrower. Keep it in view, and drop the smooth scroll on first load like the review said.',
      comments: 1,
      reply: {
        headline:
          'The active tab stays in view when the row resizes, and the first render no longer animates.',
        points: [
          {
            ask: 'Keep the active tab in view when the window narrows',
            outcome: 'done',
            note: 'A `ResizeObserver` on the row scrolls the active tab back to the centre.',
          },
          {
            ask: 'No smooth scroll on first load',
            outcome: 'done',
            note: 'The first scroll is `instant`; only later selections are smooth.',
          },
          {
            ask: 'Line comment: rename `listRef`',
            outcome: 'not_changed',
            note: 'It matches `rowRef` in the other tab components, so I kept the name for consistency.',
          },
        ],
        next: '1. Open the paywall editor on a store with more than 20 tabs, at about 900px wide.\n2. Select the last tab, then narrow the window: it should stay centred.\n3. Reload the page on a later tab: the row should not slide.',
      },
    },
  ]);
}
