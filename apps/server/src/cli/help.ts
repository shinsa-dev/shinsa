import { describeSections, describeSurface, serializeReference } from '../surface/index.ts';

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

const EVERYDAY_COMMANDS: CliCommand[] = [
  {
    name: '.',
    usage: 'shinsa [folder]',
    summary: 'Open the app, on the project of a folder: `shinsa .` for this one.',
    detail:
      'Alone it opens the app on Home. With a folder it focuses the app on the project of the repository the folder is in, or says that Shinsa has not worked there yet.',
    options: [],
    examples: ['shinsa', 'shinsa .', 'shinsa ~/Developer/shop'],
  },
  {
    name: 'open',
    usage: 'shinsa open [task]',
    summary: 'Open the app on a task: SW-142, its id or its title.',
    detail: 'Without a task it opens the app on Home; a folder works as it does for `shinsa <folder>`.',
    options: [],
    examples: ['shinsa open SW-142'],
  },
  {
    name: 'do',
    usage: 'shinsa do <request...> [--plan-first] [--urgent | --high]',
    summary: 'Hand Shinsa a piece of work.',
    detail:
      'The folder you run it in tells triage where the work is. Shinsa classifies the request, plans it and builds it, and brings it back when it needs a decision.',
    options: [
      { flag: '--plan-first', text: 'Wait for you to approve a plan before building.' },
      ...PRIORITY_OPTIONS,
    ],
    examples: ['shinsa do "fix the scroll in tab groups"', 'shinsa do "add search to the docs" --plan-first'],
  },
  {
    name: 'import',
    usage: 'shinsa import <session> [--in <folder>] [--urgent | --high]',
    summary: 'Turn a Claude Code session into a task.',
    detail:
      'Takes a session file (.jsonl) or a session id. The task starts with a plan for you to approve, so nothing builds until you have looked.',
    options: [
      { flag: '--in <folder>', text: 'Work in this folder instead of the one the session ran in.' },
      ...PRIORITY_OPTIONS,
    ],
    examples: ['shinsa import 0b9c2f4e-6a8d', 'shinsa import ~/session.jsonl --in ~/Developer/shop'],
  },
  {
    name: 'status',
    usage: 'shinsa status [--json]',
    summary: 'Whether the engine is running, and what needs you.',
    detail:
      'Shows the engine’s version and data folder, the Home guide, the decisions waiting for you and what agents are working on. Exits with 1 when the engine is not running, and never starts it.',
    options: [JSON_OPTION],
    examples: ['shinsa status'],
  },
];

const ENGINE_COMMANDS: CliCommand[] = [
  {
    name: 'start',
    usage: 'shinsa start',
    summary: 'Start the engine.',
    detail:
      'Asks launchd to start the engine the Shinsa app set up, and waits until it answers. Any other command that needs the engine starts it the same way.',
    options: [],
    examples: ['shinsa start'],
  },
  {
    name: 'stop',
    usage: 'shinsa stop',
    summary: 'Stop the engine. Agents resume when it starts again.',
    detail:
      'Waits until it has stopped cleanly. It stays stopped until `shinsa start`, the Shinsa app or a command that needs it starts it again, or until you next log in.',
    options: [],
    examples: ['shinsa stop'],
    humanOnly: true,
  },
  {
    name: 'restart',
    usage: 'shinsa restart [--when-idle]',
    summary: 'Restart the engine, now or once agents are idle.',
    detail:
      'Restarts the engine and waits until the new one answers. Runs it cuts off resume on their own sessions.',
    options: [{ flag: '--when-idle', text: 'Wait until no agent is mid-turn, then restart.' }],
    examples: ['shinsa restart', 'shinsa restart --when-idle'],
    humanOnly: true,
  },
  {
    name: 'logs',
    usage: 'shinsa logs [--lines <count>] [--json]',
    summary: 'Show the end of the engine’s log.',
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
    summary: 'Show the version of this command and of the engine.',
    detail: 'Also `shinsa --version`. Says when the engine runs another version than the app carries.',
    options: [JSON_OPTION],
    examples: ['shinsa version'],
  },
];

export const CLI_COMMANDS = [...EVERYDAY_COMMANDS, ...ENGINE_COMMANDS];

const EXAMPLES = [
  'shinsa .',
  'shinsa do "fix the scroll in tab groups" --plan-first',
  'shinsa tasks list --status needs_you',
  'shinsa reviews approve SW-142',
  'shinsa restart --when-idle',
];

const USAGE_WIDTH = 28;

export function selectCliCommand(name: string) {
  return CLI_COMMANDS.find((command) => command.name === name) ?? null;
}

function stripTicks(text: string) {
  return text.replaceAll('`', '');
}

function describeCommandLines(commands: CliCommand[]) {
  return commands.map(
    (command) =>
      `  ${(command.usage.split(' [-')[0] ?? '').padEnd(USAGE_WIDTH)} ${stripTicks(command.summary)}`
  );
}

function describeTopLevel() {
  return [
    'Shinsa hands coding work to agents and brings back only the decisions.',
    '',
    'Everyday',
    ...describeCommandLines(EVERYDAY_COMMANDS),
    '',
    'Engine (the Shinsa app keeps it running in the background)',
    ...describeCommandLines(ENGINE_COMMANDS),
  ].join('\n');
}

export const USAGE = [
  describeTopLevel(),
  '',
  describeSections(),
  '',
  'Examples',
  ...EXAMPLES.map((example) => `  ${example}`),
  '',
  'Run `shinsa <group>` for its commands, and add --help to any command for its arguments.',
  '--json prints any answer as JSON. `shinsa help --all` lists every command.',
].join('\n');

export const USAGE_ALL = [
  describeTopLevel(),
  '',
  'Everything else',
  describeSurface(),
  '',
  'Add --help to any command for its arguments, --json for JSON.',
].join('\n');

export function describeCliUsage(command: CliCommand) {
  return [
    stripTicks(command.summary),
    '',
    'Usage',
    `  ${command.usage}`,
    '',
    stripTicks(command.detail),
    ...(command.options.length > 0
      ? ['', 'Options', ...command.options.map((option) => `  ${option.flag.padEnd(22)} ${option.text}`)]
      : []),
    '',
    'Examples',
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
  '<!-- Everything below is generated from apps/server/src/cli and apps/server/src/surface by `bun run --cwd apps/server docs:cli`, and a test fails when it falls behind. -->';

function serializeCliReference() {
  return [
    '## Everyday commands',
    '',
    EVERYDAY_COMMANDS.map(serializeCommandReference).join('\n\n'),
    '',
    '## The engine',
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
