import { USER_COMMAND_TYPES, type UserCommand } from '@shinsa/core';
import {
  type Display,
  describeHeading,
  describeList,
  describeParagraph,
  describeUsageLines,
  PLAIN_DISPLAY,
} from '../terminal/index.ts';
import { CONFIG_SPECS } from './config.ts';
import { EXTENSION_SPECS } from './extensions.ts';
import { type FieldSpec, serializeFlag, type Values } from './fields.ts';
import { GATE_SPECS } from './gates.ts';
import { MEMORY_SPECS } from './memory.ts';
import { SCHEDULE_SPECS } from './schedules.ts';
import { SERVICE_SPECS } from './services.ts';
import { describeTaskLink, type SurfaceSpec } from './spec.ts';
import { SYSTEM_SPECS } from './system.ts';
import { TASK_SPECS } from './tasks.ts';
import { WATCHDOG_SPECS } from './watchdogs.ts';
import { WORK_SPECS } from './work.ts';

export { type CommandReceipt, resolveCommandKey, type SurfaceClient } from './client.ts';
export { readArgv, readToolInput, resolveInputSchema, type Values } from './fields.ts';
export type { SurfaceSpec } from './spec.ts';
export { describeQueue, describeUptime, QUEUE_EMPTY } from './system.ts';

const COMMAND_SPEC: SurfaceSpec = {
  path: ['command'],
  summary: 'Send any command Shinsa understands, by its type and fields. The other commands are friendlier.',
  access: 'write',
  humanOnly: true,
  fields: [
    {
      name: 'type',
      kind: 'choice',
      choices: USER_COMMAND_TYPES,
      positional: 'one',
      required: true,
      description: 'The command type.',
    },
    { name: 'fields', kind: 'json', description: 'Its fields as a JSON object, such as {"taskId":"…"}.' },
  ],
  run: async (client, values: Values) => {
    const receipt = await client.send({ ...(values.fields as object), type: values.type } as UserCommand);
    const link = describeTaskLink(client, receipt);
    return { data: receipt, text: link ? `Done.\n${link}` : 'Done.' };
  },
};

export const SURFACE: SurfaceSpec[] = [
  ...TASK_SPECS,
  ...GATE_SPECS,
  ...WORK_SPECS,
  ...SCHEDULE_SPECS,
  ...MEMORY_SPECS,
  ...CONFIG_SPECS,
  ...SYSTEM_SPECS,
  ...SERVICE_SPECS,
  ...EXTENSION_SPECS,
  ...WATCHDOG_SPECS,
  COMMAND_SPEC,
];

export function listUncoveredCommands(specs: SurfaceSpec[] = SURFACE) {
  return USER_COMMAND_TYPES.filter((type) => !specs.some((spec) => spec.command === type));
}

export function resolveToolName(spec: SurfaceSpec) {
  return spec.path.join('_').replaceAll('-', '_');
}

export function selectSpec(words: string[], specs: SurfaceSpec[] = SURFACE) {
  const matches = specs
    .filter((candidate) => candidate.path.every((part, index) => words[index] === part))
    .sort((a, b) => b.path.length - a.path.length);
  const spec = matches[0];
  return spec ? { spec, rest: words.slice(spec.path.length) } : null;
}

export function listGroup(group: string, specs: SurfaceSpec[] = SURFACE) {
  return specs.filter((spec) => spec.path[0] === group);
}

function describeArgument(field: FieldSpec) {
  if (field.positional) {
    const name = field.positional === 'rest' ? `<${field.name}...>` : `<${field.name}>`;
    return field.required ? name : `[${name}]`;
  }
  const flag = serializeFlag(field.name);
  const value =
    field.kind === 'boolean'
      ? ''
      : ` <${field.kind === 'choice' ? (field.choices ?? []).join('|') : field.kind}>`;
  return field.required ? `${flag}${value}` : `[${flag}${value}]`;
}

function describeArgumentTerm(display: Display, field: FieldSpec) {
  return display.style.accent(field.positional ? `<${field.name}>` : serializeFlag(field.name));
}

export function describeUsage(spec: SurfaceSpec, display: Display = PLAIN_DISPLAY) {
  const options = spec.fields.map((field) => ({
    term: describeArgumentTerm(display, field),
    text: field.description,
  }));
  return [
    ...describeParagraph(display, spec.summary),
    '',
    describeHeading(display, 'Usage'),
    ...describeUsageLines(
      display,
      ['shinsa', ...spec.path],
      [...spec.fields.map(describeArgument), '[--json]']
    ),
    ...(options.length > 0
      ? ['', describeHeading(display, 'Arguments'), ...describeList(display, options)]
      : []),
  ].join('\n');
}

function selectGroupSummary(group: string) {
  for (const section of SURFACE_SECTIONS) {
    const found = section.groups.find(([name]) => name === group);
    if (found) return found[1];
  }
  return null;
}

export function describeGroup(
  group: string,
  specs: SurfaceSpec[] = SURFACE,
  display: Display = PLAIN_DISPLAY
) {
  const entries = listGroup(group, specs).map((spec) => ({
    term: display.style.accent(spec.path.slice(1).join(' ')),
    text: spec.summary,
  }));
  return [
    ...describeParagraph(display, selectGroupSummary(group) ?? `shinsa ${group}`),
    '',
    describeHeading(display, 'Usage'),
    ...describeUsageLines(display, ['shinsa', group], ['<command>', '[arguments]', '[--json]']),
    '',
    describeHeading(display, 'Commands'),
    ...describeList(display, entries),
    '',
    ...describeParagraph(
      display,
      'Add --help to any of them for its arguments, --json for machine-readable output.'
    ),
  ].join('\n');
}

export function describeSurface(display: Display, termWidth?: number, specs: SurfaceSpec[] = SURFACE) {
  return describeList(
    display,
    specs.map((spec) => ({
      term: display.style.accent(`shinsa ${spec.path.join(' ')}`),
      text: spec.summary,
    })),
    termWidth === undefined ? {} : { termWidth }
  );
}

interface SurfaceSection {
  title: string;
  groups: readonly (readonly [group: string, summary: string])[];
}

const SURFACE_SECTIONS: readonly SurfaceSection[] = [
  {
    title: 'Steer tasks and answer what agents ask',
    groups: [
      ['tasks', 'List, open and create tasks; message, retry, reprioritize, cancel or finish one.'],
      ['plans', 'Approve a plan, ask the agent to revise it, or reject it.'],
      ['reviews', 'Approve a change, send it back with comments, or reject it.'],
      ['merges', 'Merge a task’s pull request, or decline the merge.'],
      ['questions', 'Answer a question an agent stopped to ask you.'],
      ['operations', 'Run a task’s operation once its change merged, or finish the task without it.'],
      ['gates', 'Answer any waiting decision by its id, or hand an agent a secret.'],
      ['rounds', 'Ship a round onto the open pull request or as a stacked one.'],
      ['runs', 'Snooze or dismiss the warning that an agent has gone quiet.'],
      ['delegations', 'List the work a step handed to other agents, or stop it.'],
      ['suggestions', 'Accept, keep or dismiss the follow-up tasks agents suggest.'],
      ['watchdogs', 'Stop a watchdog on a merged change, or connect the data source it waits for.'],
    ],
  },
  {
    title: 'Start tasks on a schedule or from a webhook',
    groups: [['schedules', 'List, create, pause, resume or delete schedules, and manage webhook URLs.']],
  },
  {
    title: 'Choose what agents remember',
    groups: [
      [
        'memory',
        'List the rules every agent follows, write or remove one, and keep the ones agents propose.',
      ],
    ],
  },
  {
    title: 'Set up projects, repositories and accounts',
    groups: [
      ['projects', 'Group repositories and folders into projects, with a key for task handles.'],
      ['sources', 'List, add or remove the data sources a project’s watchdogs read.'],
      ['focus', 'Show only one project’s work, for a while or until you clear it.'],
      ['repos', 'List repositories, and change their checks, base branch or where agents work.'],
      ['folders', 'Choose the folders Shinsa searches for repositories.'],
      ['accounts', 'Sign in, import, refresh or remove the Claude accounts agents run on.'],
      ['settings', 'Read or change a setting by its name.'],
      ['setup', 'Show where setup stands, and check the tools Shinsa needs.'],
    ],
  },
  {
    title: 'Choose what agents can use',
    groups: [
      ['mcp', 'List, add, turn on or off, and sign in to the MCP servers agents load.'],
      ['skills', 'List the skills agents can load, and turn them on or off.'],
      ['plugins', 'List the Claude Code plugins agents run with, and turn them on or off.'],
    ],
  },
  {
    title: 'Run your projects’ services',
    groups: [['services', 'List, start, stop or restart a project’s services, such as its dev servers.']],
  },
  {
    title: 'Inspect Shinsa',
    groups: [
      ['queue', 'List what needs your decision and what agents are working on.'],
      ['activity', 'List what agents did on your behalf, oldest first.'],
      ['usage', 'Show how much of each account’s usage limits is spent, and when it resets.'],
      ['providers', 'List the agent providers, Claude and Codex, and their models.'],
      ['versions', 'Show the installed Claude Code, Codex and Agent SDK, and update them.'],
      ['terminals', 'List your terminals in Shinsa and whether each shell still runs.'],
      ['health', 'Check that the engine read its event log without damaged entries.'],
      ['command', 'Send any engine command by its type and fields, for scripts.'],
    ],
  },
];

export function listUncatalogedGroups(specs: SurfaceSpec[] = SURFACE) {
  const cataloged = new Set(listSectionGroups());
  return listGroups(specs).filter((group) => !cataloged.has(group));
}

export function describeSections(
  display: Display,
  termWidth: number,
  sections: readonly SurfaceSection[] = SURFACE_SECTIONS
) {
  return sections.flatMap((section) => [
    describeHeading(display, section.title),
    ...describeList(
      display,
      section.groups.map(([group, summary]) => ({ term: display.style.accent(group), text: summary })),
      { termWidth }
    ),
    '',
  ]);
}

export function listSectionGroups(sections: readonly SurfaceSection[] = SURFACE_SECTIONS) {
  return sections.flatMap((section) => section.groups.map(([group]) => group));
}

export function listAgentSpecs(specs: SurfaceSpec[] = SURFACE) {
  return specs.filter((spec) => !spec.humanOnly && !spec.agentTool);
}

function listGroups(specs: SurfaceSpec[]) {
  return [...new Set(specs.map((spec) => spec.path[0] ?? ''))];
}

function serializeArgumentRow(field: FieldSpec) {
  const name = field.positional ? `<${field.name}>` : serializeFlag(field.name);
  const required = field.required ? 'required' : 'optional';
  return `| \`${name}\` | ${field.kind}, ${required} | ${field.description} |`;
}

function describeAgentAccess(spec: SurfaceSpec) {
  if (spec.humanOnly) return 'Yours alone: no agent has a tool for it, and an agent’s shell may not run it.';
  if (spec.agentTool) return `Not a task agent's tool: an agent uses \`${spec.agentTool}\` instead.`;
  return `Every task agent's tool: \`${resolveToolName(spec)}\`${spec.access === 'read' ? ' (reads)' : ''}.`;
}

function serializeSpecReference(spec: SurfaceSpec) {
  const fields = spec.fields;
  const usage = ['shinsa', ...spec.path, ...fields.map(describeArgument), '[--json]'].join(' ');
  const sends = spec.command ? ` Sends \`${spec.command}\`.` : '';
  return [
    `#### shinsa ${spec.path.join(' ')}`,
    '',
    spec.summary,
    '',
    '```',
    usage,
    '```',
    '',
    `${describeAgentAccess(spec)}${sends}`,
    ...(fields.length > 0
      ? ['', '| Argument | Kind | What it is |', '| --- | --- | --- |', ...fields.map(serializeArgumentRow)]
      : []),
  ].join('\n');
}

export function serializeReference(specs: SurfaceSpec[] = SURFACE) {
  const groups = listGroups(specs).map((group) =>
    [`### ${group}`, ...listGroup(group, specs).map(serializeSpecReference)].join('\n\n')
  );
  return [
    '## The groups',
    '',
    'Generated from the specs in `apps/engine/src/surface`. How the surface works is `docs/engine.md` → The command',
    'surface.',
    '',
    '`--help` on a group or a command prints its usage; `--json` prints the answer as JSON, and a refusal as',
    '`{ "error": { "code", "message" } }` with exit code 1. A task is named by its handle (SW-142), its id, the start of',
    'its id or its exact title; an account by id or email; a repository by name or id; a project by key, name or id.',
    'Every task agent has each command that is not yours alone as a tool of the same name with `_` for spaces and',
    'dashes, taking the same fields in snake_case; what it does is logged as on your behalf from its task. A command',
    'marked yours alone has no tool (`docs/engine.md` → Who can change Shinsa), and `tasks create` has none either:',
    'an agent files a task with `create_task`, which files it once however often the call is repeated.',
    '',
    groups.join('\n\n'),
  ].join('\n');
}
