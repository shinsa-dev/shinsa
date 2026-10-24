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

export function listAgentSpecs(specs: SurfaceSpec[] = SURFACE) {
  return specs.filter((spec) => !spec.humanOnly);
}

function listGroups(specs: SurfaceSpec[]) {
  return [...new Set(specs.map((spec) => spec.path[0] ?? ''))];
}

function serializeArgumentRow(field: FieldSpec) {
  const name = field.positional ? `<${field.name}>` : serializeFlag(field.name);
  const required = field.required ? 'required' : 'optional';
  return `| \`${name}\` | ${field.kind}, ${required} | ${field.description} |`;
}

function serializeSpecReference(spec: SurfaceSpec) {
  const fields = spec.fields;
  const usage = ['shinsa', ...spec.path, ...fields.map(describeArgument), '[--json]'].join(' ');
  const where = spec.humanOnly
    ? 'Yours alone: no agent has a tool for it, and an agent’s shell may not run it.'
    : `Every task agent's tool: \`${resolveToolName(spec)}\`${spec.access === 'read' ? ' (reads)' : ''}.`;
  const sends = spec.command ? ` Sends \`${spec.command}\`.` : '';
  return [
    `### shinsa ${spec.path.join(' ')}`,
    '',
    spec.summary,
    '',
    '```',
    usage,
    '```',
    '',
    `${where}${sends}`,
    ...(fields.length > 0
      ? ['', '| Argument | Kind | What it is |', '| --- | --- | --- |', ...fields.map(serializeArgumentRow)]
      : []),
  ].join('\n');
}

export function serializeReference(specs: SurfaceSpec[] = SURFACE) {
  const groups = listGroups(specs).map((group) =>
    [`## ${group}`, ...listGroup(group, specs).map(serializeSpecReference)].join('\n\n')
  );
  return `${[
    '# The `shinsa` command line',
    '',
    'Generated from the specs in `apps/server/src/surface` by `bun run --cwd apps/server docs:cli`; a test fails when',
    'this file and the specs differ. How the surface works is `docs/engine.md` → The command surface.',
    '',
    'Every command talks to the running server on the configured host (`SHINSA_HOST` or `hostname` in `config.json`;',
    '127.0.0.1 when the server listens on every address) and port (`SHINSA_PORT` or `port` in `config.json`, 5180).',
    '`--help` on a group or a command prints its usage; `--json` prints the answer as JSON, and a refusal as',
    '`{ "error": { "code", "message" } }` with exit code 1. A task is named by its handle (SW-142), its id, the start of',
    'its id or its exact title; an account by id or email; a repository by name or id; a project by key, name or id.',
    'Every task agent has each command that is not yours alone as a tool of the same name with `_` for spaces and',
    'dashes, taking the same fields in snake_case; what it does is logged as on your behalf from its task. A command',
    'marked yours alone has no tool (`docs/engine.md` → Who can change Shinsa).',
    '',
    ...groups.flatMap((group) => [group, '']),
  ]
    .join('\n')
    .trimEnd()}\n`;
}
