import { describeVersion } from '../instance/index.ts';
import {
  describeSections,
  describeSurface,
  listSectionGroups,
  SURFACE,
  serializeReference,
} from '../surface/index.ts';
import {
  type Display,
  describeCommandTerm,
  describeHeading,
  describeList,
  describeParagraph,
  describeUsageLines,
  PLAIN_DISPLAY,
  resolveTermWidth,
  splitUsage,
} from '../terminal/index.ts';
import { type CommandVersion, resolveCommandVersion } from './engine.ts';

interface CliOption {
  flag: string;
  text: string;
}

export interface CliCommand {
  name: string;
  usage: string;
  summary: string;
  detail: string;
  options: CliOption[];
  examples: string[];
  humanOnly?: boolean;
}

const JSON_OPTION: CliOption = { flag: '--json', text: 'Print the answer as JSON.' };

const PRIORITY_OPTIONS: CliOption[] = [
  { flag: '--urgent', text: 'Put it ahead of everything else.' },
  { flag: '--high', text: 'Put it ahead of normal work.' },
];

const OPEN_COMMANDS: CliCommand[] = [
  {
    name: '.',
    usage: 'shinsa [folder]',
    summary: 'Open the app; in a repository, open it on that repository’s project.',
    detail:
      'Alone it opens the app on Home. With a folder it focuses the app on the project of the repository the folder is in, or says that Shinsa has not worked there yet.',
    options: [],
    examples: ['shinsa', 'shinsa .', 'shinsa ~/Developer/shop'],
  },
  {
    name: 'open',
    usage: 'shinsa open [task]',
    summary: 'Open the app on a task, by its handle (SW-142), id or title.',
    detail: 'Without a task it opens the app on Home; a folder works as it does for `shinsa <folder>`.',
    options: [],
    examples: ['shinsa open SW-142'],
  },
  {
    name: 'do',
    usage: 'shinsa do <request...> [--plan-first | --backlog] [--urgent | --high]',
    summary: 'Create a task from a request; Shinsa picks the kind of work and runs it.',
    detail:
      'The folder you run it in tells triage where the work is. Shinsa classifies the request, plans it and builds it, and brings it back when it needs a decision.',
    options: [
      { flag: '--plan-first', text: 'Wait for you to approve a plan before building.' },
      { flag: '--backlog', text: 'Plan it now and keep it in the backlog until you start building it.' },
      ...PRIORITY_OPTIONS,
    ],
    examples: ['shinsa do "fix the scroll in tab groups"', 'shinsa do "add search to the docs" --plan-first'],
  },
  {
    name: 'import',
    usage: 'shinsa import <session> [--in <folder>] [--urgent | --high]',
    summary: 'Create a task from a Claude Code session, starting with a plan to approve.',
    detail:
      'Takes a session file (.jsonl) or a session id. The task starts with a plan for you to approve, so nothing builds until you have looked.',
    options: [
      { flag: '--in <folder>', text: 'Work in this folder instead of the one the session ran in.' },
      ...PRIORITY_OPTIONS,
    ],
    examples: ['shinsa import 0b9c2f4e-6a8d', 'shinsa import ~/session.jsonl --in ~/Developer/shop'],
  },
];

const ENGINE_COMMANDS: CliCommand[] = [
  {
    name: 'status',
    usage: 'shinsa status [--json]',
    summary: 'Show whether the engine runs, what needs you and what agents are doing.',
    detail:
      'Shows the engine’s version and data folder, the Home guide, the decisions waiting for you and what agents are working on. Exits with 1 when the engine is not running, and never starts it.',
    options: [JSON_OPTION],
    examples: ['shinsa status'],
  },
  {
    name: 'start',
    usage: 'shinsa start',
    summary: 'Start the engine in the background and wait until it answers.',
    detail:
      'On a Mac with the Shinsa app, asks launchd to start the engine the app set up. On a Mac without it, sets the engine up as its own launchd agent the first time (it starts at login and again after a crash) and starts it; it never starts a second engine beside the app’s. On Linux, sets the engine up as a systemd user service the first time (it starts at boot once lingering is on, and again after a crash) and starts it. Then waits until it answers. Any other command that needs the engine starts it the same way.',
    options: [],
    examples: ['shinsa start'],
  },
  {
    name: 'stop',
    usage: 'shinsa stop',
    summary: 'Stop the engine cleanly. Runs resume when it starts again.',
    detail:
      'Waits until it has stopped cleanly. It stays stopped until `shinsa start`, the Shinsa app or a command that needs it starts it again, or until you next log in. An engine still running after 40 seconds is killed; on a Mac, launchd then starts a fresh one.',
    options: [],
    examples: ['shinsa stop'],
    humanOnly: true,
  },
  {
    name: 'restart',
    usage: 'shinsa restart [--when-idle]',
    summary: 'Restart the engine now, or with --when-idle once no agent is mid-turn.',
    detail:
      'Restarts the engine and waits until the new one answers. Runs it cuts off resume on their own sessions.',
    options: [{ flag: '--when-idle', text: 'Wait until no agent is mid-turn, then restart.' }],
    examples: ['shinsa restart', 'shinsa restart --when-idle'],
    humanOnly: true,
  },
  {
    name: 'logs',
    usage: 'shinsa logs [--lines <count>] [--json]',
    summary: 'Print the last lines of the engine’s log, 50 unless --lines says more.',
    detail:
      'Reads `engine.log` in the data folder, one line per entry: the time in UTC, the level, the message and its fields.',
    options: [
      { flag: '--lines <count>', text: 'How many lines, 50 by default.' },
      { flag: '--json', text: 'Print the lines as the engine wrote them.' },
    ],
    examples: ['shinsa logs', 'shinsa logs --lines 200'],
  },
  {
    name: 'version',
    usage: 'shinsa version [--json]',
    summary: 'Print the version of this command and of the running engine.',
    detail: 'Also `shinsa --version`. Says when the engine runs another version than the app carries.',
    options: [JSON_OPTION],
    examples: ['shinsa version'],
  },
];

export const CLI_COMMANDS = [...OPEN_COMMANDS, ...ENGINE_COMMANDS];

const EXAMPLES = [
  'shinsa .',
  'shinsa do "fix the scroll in tab groups" --plan-first',
  'shinsa tasks list --status needs_you',
  'shinsa reviews approve SW-142',
  'shinsa restart --when-idle',
];

export function selectCliCommand(name: string) {
  return CLI_COMMANDS.find((command) => command.name === name) ?? null;
}

function resolveCommandHead(command: CliCommand) {
  return command.usage.split(' [-')[0] ?? '';
}

function describeCommandSection(display: Display, title: string, commands: CliCommand[], termWidth: number) {
  return [
    describeHeading(display, title),
    ...describeList(
      display,
      commands.map((command) => ({
        term: describeCommandTerm(display, resolveCommandHead(command)),
        text: command.summary,
      })),
      { termWidth }
    ),
    '',
  ];
}

function describeBanner(display: Display, version: CommandVersion) {
  const { style } = display;
  return [
    ...describeParagraph(
      display,
      `${style.bold('Shinsa')} hands coding work to agents and brings back only the decisions. ${style.dim(`(${describeVersion(version)})`)}`
    ),
    '',
    describeHeading(display, 'Usage'),
    ...describeUsageLines(display, ['shinsa'], ['<command>', '[arguments]', '[--json]']),
    '',
  ];
}

function resolveTopTermWidth(extra: string[]) {
  return resolveTermWidth([...CLI_COMMANDS.map(resolveCommandHead), ...extra]);
}

function describeTopLevel(display: Display, termWidth: number) {
  return [
    ...describeCommandSection(display, 'Open Shinsa and hand it work', OPEN_COMMANDS, termWidth),
    ...describeCommandSection(display, 'Check and control the background engine', ENGINE_COMMANDS, termWidth),
  ];
}

export function describeHelp(display: Display = PLAIN_DISPLAY, version = resolveCommandVersion()) {
  const termWidth = resolveTopTermWidth(listSectionGroups());
  return [
    ...describeBanner(display, version),
    ...describeTopLevel(display, termWidth),
    ...describeSections(display, termWidth),
    describeHeading(display, 'Examples'),
    ...EXAMPLES.map((example) => `  ${example}`),
    '',
    ...describeParagraph(
      display,
      'Run `shinsa <group>` for its commands, and add --help to any command for its arguments. --json prints any answer as JSON, and `shinsa help --all` lists every command.'
    ),
  ].join('\n');
}

export function describeHelpAll(display: Display = PLAIN_DISPLAY, version = resolveCommandVersion()) {
  const commands = SURFACE.map((spec) => `shinsa ${spec.path.join(' ')}`);
  const termWidth = resolveTopTermWidth(commands);
  return [
    ...describeBanner(display, version),
    ...describeTopLevel(display, termWidth),
    describeHeading(display, 'Everything else'),
    ...describeSurface(display, termWidth),
    '',
    ...describeParagraph(display, 'Add --help to any command for its arguments, --json for JSON.'),
  ].join('\n');
}

export function describeCliUsage(command: CliCommand, display: Display = PLAIN_DISPLAY) {
  const { head, args } = splitUsage(command.usage);
  return [
    ...describeParagraph(display, command.summary),
    '',
    describeHeading(display, 'Usage'),
    ...describeUsageLines(display, head, args),
    '',
    ...describeParagraph(display, command.detail),
    ...(command.options.length > 0
      ? [
          '',
          describeHeading(display, 'Options'),
          ...describeList(
            display,
            command.options.map((option) => ({ term: display.style.accent(option.flag), text: option.text }))
          ),
        ]
      : []),
    '',
    describeHeading(display, 'Examples'),
    ...command.examples.map((example) => `  ${example}`),
  ].join('\n');
}

function serializeCommandReference(command: CliCommand) {
  return [
    `### ${command.name === '.' ? 'shinsa [folder]' : `shinsa ${command.name}`}`,
    '',
    `${command.summary} ${command.detail}`,
    '',
    '```',
    command.usage,
    ...command.examples.map((example) => `$ ${example}`),
    '```',
    ...(command.options.length > 0
      ? [
          '',
          '| Option | What it does |',
          '| --- | --- |',
          ...command.options.map((option) => `| \`${option.flag}\` | ${option.text} |`),
        ]
      : []),
    ...(command.humanOnly
      ? ['', 'Yours alone: an agent’s shell may not run it, since the engine runs the agent.']
      : []),
  ].join('\n');
}

export const REFERENCE_MARKER =
  '<!-- Everything below is generated from apps/engine/src/cli and apps/engine/src/surface by `bun run --cwd apps/engine docs:cli`, and a test fails when it falls behind. -->';

function serializeCliReference() {
  return [
    '## Open Shinsa and hand it work',
    '',
    OPEN_COMMANDS.map(serializeCommandReference).join('\n\n'),
    '',
    '## Check and control the background engine',
    '',
    ENGINE_COMMANDS.map(serializeCommandReference).join('\n\n'),
    '',
    serializeReference(),
  ].join('\n');
}

export function replaceReference(doc: string) {
  const at = doc.indexOf(REFERENCE_MARKER);
  const head = at === -1 ? doc : doc.slice(0, at);
  return `${head.trimEnd()}\n\n${REFERENCE_MARKER}\n\n${serializeCliReference()}\n`;
}
