import { USER_COMMAND_TYPES, type UserCommand } from '@shinsa/core';
import { CONFIG_SPECS } from './config.ts';
import { EXTENSION_SPECS } from './extensions.ts';
import { type FieldSpec, serializeFlag, type Values } from './fields.ts';
import { GATE_SPECS } from './gates.ts';
import { SCHEDULE_SPECS } from './schedules.ts';
import { describeTaskLink, type SurfaceSpec } from './spec.ts';
import { SYSTEM_SPECS } from './system.ts';
import { TASK_SPECS } from './tasks.ts';
import { WORK_SPECS } from './work.ts';

export { type CommandReceipt, resolveCommandKey, type SurfaceClient } from './client.ts';
export { readArgv, readToolInput, resolveInputSchema, type Values } from './fields.ts';
export type { SurfaceSpec } from './spec.ts';
export { describeRunning } from './system.ts';

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
  ...CONFIG_SPECS,
  ...SYSTEM_SPECS,
  ...EXTENSION_SPECS,
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

export function describeUsage(spec: SurfaceSpec) {
  const fields = spec.fields;
  const usage = ['shinsa', ...spec.path, ...fields.map(describeArgument), '[--json]'].join(' ');
  const options = fields.map(
    (field) =>
      `  ${(field.positional ? `<${field.name}>` : serializeFlag(field.name)).padEnd(22)} ${field.description}`
  );
  return [
    spec.summary,
    '',
    'Usage',
    `  ${usage}`,
    ...(options.length > 0 ? ['', 'Arguments', ...options] : []),
  ].join('\n');
}

export function describeGroup(group: string, specs: SurfaceSpec[] = SURFACE) {
  const lines = listGroup(group, specs).map(
    (spec) => `  shinsa ${spec.path.join(' ').padEnd(26)} ${spec.summary}`
  );
  return [
    `shinsa ${group}`,
    '',
    ...lines,
    '',
    'Add --help to any of them for its arguments, --json for machine-readable output.',
  ].join('\n');
}

export function describeSurface(specs: SurfaceSpec[] = SURFACE) {
  return specs.map((spec) => `  shinsa ${spec.path.join(' ').padEnd(26)} ${spec.summary}`).join('\n');
}

interface SurfaceSection {
  title: string;
  groups: readonly (readonly [group: string, summary: string])[];
}

const SURFACE_SECTIONS: readonly SurfaceSection[] = [
  {
    title: 'Work',
    groups: [
      ['tasks', 'List, show, create and steer tasks.'],
      ['plans', 'Approve, revise or reject a plan.'],
      ['reviews', 'Approve, revise or reject the changes of a task.'],
      ['merges', 'Merge the pull request of a task, or decline to.'],
      ['questions', 'Answer an agent’s question.'],
      ['operations', 'Run or skip the operation of a change that merged.'],
      ['gates', 'Answer any decision by its id, or give a secret an agent asked for.'],
      ['rounds', 'Choose how a round ships.'],
      ['runs', 'Snooze or dismiss the warning about a quiet agent.'],
      ['delegations', 'List or stop the work a step handed to other agents.'],
      ['suggestions', 'Accept, keep or dismiss the tasks agents suggest.'],
    ],
  },
  {
    title: 'Automations',
    groups: [['schedules', 'Tasks that start on a schedule or from a webhook.']],
  },
  {
    title: 'Projects and setup',
    groups: [
      ['projects', 'The projects your repositories and folders belong to.'],
      ['focus', 'Show only one project’s work.'],
      ['repos', 'The repositories Shinsa works in.'],
      ['folders', 'The folders Shinsa looks in for repositories.'],
      ['accounts', 'The Claude accounts agents run on.'],
      ['settings', 'Read and change settings.'],
      ['setup', 'Where setup stands, and the tools Shinsa needs.'],
    ],
  },
  {
    title: 'Integrations',
    groups: [
      ['mcp', 'The MCP servers agents can use.'],
      ['skills', 'The skills agents can load.'],
      ['plugins', 'The Claude Code plugins agents run with.'],
    ],
  },
  {
    title: 'Inside Shinsa',
    groups: [
      ['queue', 'What needs a decision, and what agents are working on.'],
      ['activity', 'What agents did on your behalf.'],
      ['usage', 'How much of each account’s usage limits is used.'],
      ['providers', 'The agent providers and their models.'],
      ['versions', 'Claude Code, Codex and the Agent SDK, and their updates.'],
      ['health', 'Whether the engine loaded its log cleanly.'],
      ['command', 'Send any command by its type and fields.'],
    ],
  },
];

export function listUncatalogedGroups(specs: SurfaceSpec[] = SURFACE) {
  const cataloged = new Set(SURFACE_SECTIONS.flatMap((section) => section.groups.map(([group]) => group)));
  return listGroups(specs).filter((group) => !cataloged.has(group));
}

export function describeSections(sections: readonly SurfaceSection[] = SURFACE_SECTIONS) {
  return sections
    .map((section) =>
      [section.title, ...section.groups.map(([group, summary]) => `  ${group.padEnd(14)} ${summary}`)].join(
        '\n'
      )
    )
    .join('\n\n');
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
    'Generated from the specs in `apps/server/src/surface`. How the surface works is `docs/engine.md` → The command',
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
