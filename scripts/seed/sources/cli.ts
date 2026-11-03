import type { Files } from '../paths.ts';

const PARSE_FLAGS_BASE = `export interface ParseOptions {
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string>;
  default?: Record<string, unknown>;
}

export type ParsedFlags = Record<string, unknown> & { _: string[] };

export function parseFlags(argv: string[], options: ParseOptions = {}): ParsedFlags {
  const flags: ParsedFlags = { ...options.default, _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('-')) {
      flags._.push(token);
      continue;
    }
    const body = token.replace(/^--?/, '');
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      continue;
    }
    const [raw = '', ...rest] = body.split('=');
    const name = options.alias?.[raw] ?? raw;
    if (options.boolean?.includes(name)) {
      flags[name] = true;
      continue;
    }
    flags[name] = rest.length > 0 ? rest.join('=') : argv[++index];
  }
  return flags;
}
`;

const CLI_INDEX_BASE = `import * as commands from './commands';

const USAGE = 'Usage: superwall <command> [flags]';

export async function main(argv: string[]) {
  const [name = 'help', ...rest] = argv;
  const command = commands[toExportName(name) as keyof typeof commands];
  if (!command) {
    console.error(\`Unknown command: \${name}\\n\\n\${USAGE}\`);
    process.exit(1);
  }
  await command.run(rest);
}

function toExportName(name: string) {
  return name.replace(/-(\\w)/g, (_, letter: string) => letter.toUpperCase());
}
`;

const DEPLOY_BASE = `import { runDeploy } from '../../actions/deploy';
import { parseFlags } from '../parse-flags';

export const description = 'Build, publish and promote in one step';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, { string: ['app', 'message', 'wait'], alias: { m: 'message' } });
  const [environment] = flags._;
  if (!environment) throw new Error('deploy needs an environment: staging or production');
  await runDeploy({ environment, app: flags.app, message: flags.message, wait: Number(flags.wait ?? 120) });
}
`;

const LOGIN_BASE = `import { runLogin } from '../../actions/login';
import { parseFlags } from '../parse-flags';
import { readStdin } from '../stdin';

export const description = 'Sign in with a browser or an API token';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, { string: ['token'] });
  const token = flags.token === '-' ? await readStdin() : (flags.token as string | undefined);
  await runLogin({ token });
}
`;

const LOGS_BASE = `import { runLogs } from '../../actions/logs';
import { parseFlags } from '../parse-flags';

export const description = 'Stream the paywall event logs of the app';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, {
    boolean: ['follow'],
    string: ['app', 'since', 'limit'],
    alias: { f: 'follow' },
    default: { since: '10m', limit: '200' },
  });
  await runLogs({ ...flags, limit: Number(flags.limit) });
}
`;

export const REGISTRY_NEW = `import { parseFlags } from './parse-flags';
import { suggestName } from './suggest';

export type FlagKind = 'string' | 'boolean' | 'number';

type FlagValue<K extends FlagKind> = K extends 'boolean' ? boolean : K extends 'number' ? number : string;

export interface FlagSpec<K extends FlagKind = FlagKind> {
  kind: K;
  help: string;
  alias?: string;
  default?: FlagValue<K>;
}

export interface ArgSpec {
  name: string;
  help: string;
  required: boolean;
}

type FlagValues<F extends Record<string, FlagSpec>> = { [K in keyof F]: FlagValue<F[K]['kind']> | undefined };

export interface CommandDefinition<F extends Record<string, FlagSpec> = Record<string, FlagSpec>> {
  name: string;
  summary: string;
  args?: ArgSpec[];
  flags: F;
  hidden?: boolean;
  agents?: boolean;
  run: (input: { args: string[]; flags: FlagValues<F> }) => Promise<void>;
}

export class UsageError extends Error {}

function createFlag<K extends FlagKind>(kind: K) {
  return (help: string, options: Omit<FlagSpec<K>, 'kind' | 'help'> = {}): FlagSpec<K> => ({
    kind,
    help,
    ...options,
  });
}

export const flag = {
  string: createFlag('string'),
  boolean: createFlag('boolean'),
  number: createFlag('number'),
};

export function defineCommand<F extends Record<string, FlagSpec>>(definition: CommandDefinition<F>) {
  return definition as unknown as CommandDefinition;
}

export function parseInput(command: CommandDefinition, argv: string[]) {
  const flags: Record<string, unknown> = {};
  const args: string[] = [];
  for (const [name, spec] of Object.entries(command.flags)) flags[name] = spec.default;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('-') || token === '-') {
      args.push(token);
      continue;
    }
    const [raw = '', inline] = token.replace(/^--?/, '').split('=', 2);
    const name = resolveFlagName(command, raw);
    const spec = command.flags[name];
    if (!spec) throw new UsageError(describeUnknownFlag(command, raw));
    if (spec.kind === 'boolean') {
      flags[name] = inline !== 'false';
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined) throw new UsageError(\`--\${name} needs a value.\`);
    flags[name] = spec.kind === 'number' ? Number(value) : value;
  }
  assertArgs(command, args);
  return { args, flags };
}

function resolveFlagName(command: CommandDefinition, raw: string) {
  const aliased = Object.entries(command.flags).find(([, spec]) => spec.alias === raw);
  return aliased?.[0] ?? raw;
}

function describeUnknownFlag(command: CommandDefinition, raw: string) {
  const suggestion = suggestName(raw, Object.keys(command.flags));
  const hint = suggestion ? \` Did you mean --\${suggestion}?\` : '';
  return \`Unknown flag --\${raw} for \${command.name}.\${hint}\`;
}

function assertArgs(command: CommandDefinition, args: string[]) {
  const required = (command.args ?? []).filter((arg) => arg.required);
  if (args.length < required.length) {
    throw new UsageError(\`\${command.name} needs <\${required[args.length]?.name}>.\`);
  }
}

export function parseLegacyInput(command: CommandDefinition, argv: string[]) {
  const parsed = parseFlags(argv, {
    boolean: Object.keys(command.flags).filter((name) => command.flags[name]?.kind === 'boolean'),
  });
  return { args: parsed._, flags: parsed };
}
`;

export const SUGGEST_NEW = `const MAX_DISTANCE = 2;

export function suggestName(input: string, names: string[]) {
  let best: { name: string; distance: number } | null = null;
  for (const name of names) {
    const distance = countEdits(input, name);
    if (distance <= MAX_DISTANCE && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

function countEdits(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}
`;

export const HELP_NEW = `import type { CommandDefinition } from './registry';

export function renderHelp(command: CommandDefinition) {
  const args = (command.args ?? []).map((arg) => (arg.required ? \`<\${arg.name}>\` : \`[\${arg.name}]\`));
  const lines = [\`Usage: superwall \${[command.name, ...args, '[flags]'].join(' ')}\`, '', command.summary];
  const flags = Object.entries(command.flags);
  if (flags.length > 0) {
    lines.push('', 'Flags:');
    const width = Math.max(...flags.map(([name]) => name.length));
    for (const [name, spec] of flags) {
      const alias = spec.alias ? \`-\${spec.alias}, \` : '    ';
      const fallback = spec.default === undefined ? '' : \` (default: \${spec.default})\`;
      lines.push(\`  \${alias}--\${name.padEnd(width)}  \${spec.help}\${fallback}\`);
    }
  }
  return lines.join('\\n');
}

export function renderCommandList(commands: readonly CommandDefinition[]) {
  const visible = commands.filter((command) => !command.hidden);
  const width = Math.max(...visible.map((command) => command.name.length));
  return visible.map((command) => \`  \${command.name.padEnd(width)}  \${command.summary}\`).join('\\n');
}
`;

export const CLI_INDEX_NEW = `import { COMMANDS } from './commands';
import { renderCommandList, renderHelp } from './help';
import { parseInput, parseLegacyInput, UsageError } from './registry';

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

export async function main(argv: string[], env = process.env) {
  const [name = 'help', ...rest] = argv;
  if (name === 'help' || name === '--help') return printHelp(rest[0]);
  const command = BY_NAME.get(name);
  if (!command) return fail(\`Unknown command: \${name}\`, renderCommandList(COMMANDS));
  if (rest.includes('--help')) return console.log(renderHelp(command));
  try {
    const legacy = env.SUPERWALL_LEGACY_FLAGS === '1';
    await command.run(legacy ? parseLegacyInput(command, rest) : parseInput(command, rest));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    fail(error.message, renderHelp(command));
  }
}

function printHelp(name: string | undefined) {
  const command = name ? BY_NAME.get(name) : undefined;
  if (command) return console.log(renderHelp(command));
  console.log(\`Usage: superwall <command> [flags]\\n\\n\${renderCommandList(COMMANDS)}\`);
}

function fail(message: string, help: string): never {
  console.error(\`\${message}\\n\\n\${help}\`);
  process.exit(2);
}
`;

export const DEPLOY_NEW = `import { runDeploy } from '../../actions/deploy';
import { defineCommand, flag } from '../registry';

export default defineCommand({
  name: 'deploy',
  summary: 'Build, publish and promote in one step',
  args: [{ name: 'environment', help: 'staging or production', required: true }],
  flags: {
    app: flag.string('The app to deploy; defaults to the linked one'),
    message: flag.string('A note shown in the dashboard history', { alias: 'm' }),
    wait: flag.number('Seconds to wait for the rollout before returning', { default: 120 }),
  },
  run: ({ args, flags }) => runDeploy({ environment: args[0] ?? 'staging', ...flags }),
});
`;

const LOGIN_NEW = `import { runLogin } from '../../actions/login';
import { defineCommand, flag } from '../registry';
import { readStdin } from '../stdin';

export default defineCommand({
  name: 'login',
  summary: 'Sign in with a browser or an API token',
  agents: false,
  flags: {
    token: flag.string('An API token; pass - to read it from stdin'),
  },
  run: async ({ flags }) => {
    const token = flags.token === '-' ? await readStdin() : flags.token;
    await runLogin({ token });
  },
});
`;

const LOGS_NEW = `import { runLogs } from '../../actions/logs';
import { defineCommand, flag } from '../registry';

export default defineCommand({
  name: 'logs',
  summary: 'Stream the paywall event logs of the app',
  flags: {
    app: flag.string('The app to read; defaults to the linked one'),
    since: flag.string('How far back to start, such as 10m or 2h', { default: '10m' }),
    limit: flag.number('The most events to print', { default: 200 }),
    follow: flag.boolean('Keep streaming new events', { alias: 'f' }),
  },
  run: ({ flags }) => runLogs(flags),
});
`;

export const CODEMOD_NEW = `import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Glob } from 'bun';
import FLAG_HELP from './flag-help.json';

interface LegacyOptions {
  boolean?: string[];
  string?: string[];
  default?: Record<string, unknown>;
}

const PARSE_CALL = /parseFlags\\(argv, (\\{.*\\})\\);/;
const DESCRIPTION = /export const description = '([^']*)';/;
const ACTION_CALL = /await (run\\w+)\\(flags\\);/;

for (const path of new Glob('src/cli/commands/*.ts').scanSync()) {
  const source = readFileSync(path, 'utf8');
  const parse = PARSE_CALL.exec(source);
  const action = ACTION_CALL.exec(source)?.[1];
  if (!parse?.[1] || !action || source.includes('flags._')) {
    console.warn(\`Skipped \${path}: port it by hand.\`);
    continue;
  }
  const options = Function(\`return (\${parse[1]})\`)() as LegacyOptions;
  const name = basename(path, '.ts');
  writeFileSync(path, renderCommand(name, DESCRIPTION.exec(source)?.[1] ?? '', options, action));
}

function renderCommand(name: string, summary: string, options: LegacyOptions, action: string) {
  const flags = [
    ...(options.string ?? []).map((flag) => renderFlag(name, flag, 'string', options.default?.[flag])),
    ...(options.boolean ?? []).map((flag) => renderFlag(name, flag, 'boolean', options.default?.[flag])),
  ];
  return [
    \`import { \${action} } from '../../actions/\${name}';\`,
    "import { defineCommand, flag } from '../registry';",
    '',
    'export default defineCommand({',
    \`  name: '\${name}',\`,
    \`  summary: '\${summary}',\`,
    \`  flags: {\${flags.length > 0 ? \`\\n\${flags.join('\\n')}\\n  \` : ''}},\`,
    \`  run: ({ flags }) => \${action}(flags),\`,
    '});',
    '',
  ].join('\\n');
}

function renderFlag(command: string, name: string, kind: string, fallback: unknown) {
  const help = (FLAG_HELP as Record<string, string>)[\`\${command}.\${name}\`] ?? '';
  const options = fallback === undefined ? '' : \`, { default: \${JSON.stringify(fallback)} }\`;
  return \`    \${name}: flag.\${kind}('\${help}'\${options}),\`;
}
`;

export const DOCS_SCRIPT_NEW = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from '../src/cli/commands';
import { renderHelp } from '../src/cli/help';

const OUT = 'docs/cli';

const visible = COMMANDS.filter((command) => !command.hidden);
mkdirSync(OUT, { recursive: true });
for (const command of visible) {
  const page = [\`# superwall \${command.name}\`, '', command.summary, '', '\`\`\`text', renderHelp(command), '\`\`\`', ''];
  writeFileSync(join(OUT, \`\${command.name}.mdx\`), page.join('\\n'));
}
const index = visible.map((command) => \`- [\${command.name}](./\${command.name}): \${command.summary}\`);
writeFileSync(join(OUT, 'index.mdx'), \`# Commands\\n\\n\${index.join('\\n')}\\n\`);
`;

export const MCP_COMMANDS_NEW = `import { COMMANDS } from '../cli/commands';
import type { CommandDefinition } from '../cli/registry';

export function listCommandTools() {
  return COMMANDS.filter((command) => !command.hidden && command.agents !== false).map((command) => ({
    name: \`superwall.\${command.name}\`,
    description: command.summary,
    inputSchema: resolveInputSchema(command),
  }));
}

function resolveInputSchema(command: CommandDefinition) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [name, spec] of Object.entries(command.flags)) {
    properties[name] = { type: spec.kind, description: spec.help };
  }
  const args = command.args ?? [];
  if (args.length > 0) {
    properties.args = { type: 'array', description: args.map((arg) => \`\${arg.name}: \${arg.help}\`).join('; ') };
  }
  return { type: 'object', properties, required: args.some((arg) => arg.required) ? ['args'] : [] };
}
`;

export const HELP_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { COMMANDS } from './commands';
import { renderHelp } from './help';
import { parseInput } from './registry';

describe('command help', () => {
  for (const command of COMMANDS) {
    it(\`matches the snapshot for \${command.name}\`, () => {
      expect(renderHelp(command)).toMatchSnapshot();
    });
  }

  it('gives every flag a help text', () => {
    const missing = COMMANDS.flatMap((command) =>
      Object.entries(command.flags)
        .filter(([, spec]) => spec.help === '')
        .map(([name]) => \`\${command.name} --\${name}\`)
    );
    expect(missing).toEqual([]);
  });
});

describe('parseInput', () => {
  const push = COMMANDS.find((command) => command.name === 'push');

  it('suggests the closest flag', () => {
    expect(() => push && parseInput(push, ['--apps', 'demo'])).toThrow('Did you mean --app?');
  });

  it('asks for a missing argument', () => {
    const deploy = COMMANDS.find((command) => command.name === 'deploy');
    expect(() => deploy && parseInput(deploy, [])).toThrow('deploy needs <environment>.');
  });
});
`;

interface CliFlag {
  name: string;
  kind: 'string' | 'boolean';
  help: string;
  fallback?: boolean;
}

interface CliCommand {
  name: string;
  summary: string;
  flags: CliFlag[];
}

const APP_FLAG: CliFlag = { name: 'app', kind: 'string', help: 'The app to use; defaults to the linked one' };

const JSON_FLAG: CliFlag = { name: 'json', kind: 'boolean', help: 'Print the result as JSON' };

function createListCommand(name: string, noun: string): CliCommand {
  return { name, summary: `List the ${noun} of the app`, flags: [APP_FLAG, JSON_FLAG] };
}

const CLI_COMMANDS: CliCommand[] = [
  {
    name: 'push',
    summary: 'Upload the local paywalls to the dashboard',
    flags: [
      APP_FLAG,
      JSON_FLAG,
      {
        name: 'cache',
        kind: 'boolean',
        help: 'Reuse assets that did not change since the last push',
        fallback: true,
      },
    ],
  },
  {
    name: 'pull',
    summary: 'Download the dashboard paywalls into this folder',
    flags: [APP_FLAG, { name: 'force', kind: 'boolean', help: 'Overwrite local changes' }],
  },
  { name: 'logout', summary: 'Sign out and forget the stored token', flags: [] },
  { name: 'whoami', summary: 'Show the signed-in account', flags: [JSON_FLAG] },
  {
    name: 'init',
    summary: 'Create a superwall.config.ts in this folder',
    flags: [{ name: 'template', kind: 'string', help: 'The template to start from' }],
  },
  {
    name: 'dev',
    summary: 'Serve the paywalls locally with live reload',
    flags: [{ name: 'port', kind: 'string', help: 'The port to serve on' }],
  },
  {
    name: 'build',
    summary: 'Bundle the paywalls for publishing',
    flags: [{ name: 'out', kind: 'string', help: 'Where to write the bundle' }],
  },
  {
    name: 'preview',
    summary: 'Open a paywall in the device preview',
    flags: [{ name: 'device', kind: 'string', help: 'The device to preview on' }],
  },
  { name: 'publish', summary: 'Publish a built bundle to the dashboard', flags: [APP_FLAG, JSON_FLAG] },
  {
    name: 'promote',
    summary: 'Promote a published version to production',
    flags: [APP_FLAG, { name: 'version', kind: 'string', help: 'The version to promote' }],
  },
  {
    name: 'rollback',
    summary: 'Roll production back to the previous version',
    flags: [APP_FLAG, { name: 'yes', kind: 'boolean', help: 'Skip the confirmation' }],
  },
  { name: 'status', summary: 'Show the deploy status of the app', flags: [APP_FLAG, JSON_FLAG] },
  { name: 'open', summary: 'Open the app in the dashboard', flags: [APP_FLAG] },
  { name: 'link', summary: 'Link this folder to a dashboard app', flags: [APP_FLAG] },
  { name: 'unlink', summary: 'Forget the dashboard app linked to this folder', flags: [] },
  createListCommand('env-list', 'environment variables'),
  {
    name: 'env-set',
    summary: 'Set an environment variable',
    flags: [
      APP_FLAG,
      { name: 'name', kind: 'string', help: 'The variable to set' },
      { name: 'value', kind: 'string', help: 'The value to store' },
    ],
  },
  {
    name: 'env-unset',
    summary: 'Remove an environment variable',
    flags: [APP_FLAG, { name: 'name', kind: 'string', help: 'The variable to remove' }],
  },
  createListCommand('products', 'products'),
  createListCommand('entitlements', 'entitlements'),
  createListCommand('campaigns', 'campaigns'),
  createListCommand('placements', 'placements'),
  createListCommand('paywalls', 'paywalls'),
  { name: 'templates', summary: 'List the paywall templates you can start from', flags: [JSON_FLAG] },
  {
    name: 'doctor',
    summary: 'Check the local setup for common problems',
    flags: [{ name: 'fix', kind: 'boolean', help: 'Fix what can be fixed automatically' }],
  },
  {
    name: 'upgrade',
    summary: 'Upgrade the CLI to the latest version',
    flags: [{ name: 'channel', kind: 'string', help: 'The release channel to follow' }],
  },
  {
    name: 'completion',
    summary: 'Print the shell completion script',
    flags: [{ name: 'shell', kind: 'string', help: 'The shell to print it for' }],
  },
  {
    name: 'migrate',
    summary: 'Move a dashboard paywall into this folder as code',
    flags: [{ name: 'id', kind: 'string', help: 'The paywall to move' }],
  },
];

const HAND_PORTED = ['deploy', 'login', 'logs'];

function resolveCamelName(name: string) {
  return name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function resolveActionName(name: string) {
  const camel = resolveCamelName(name);
  return `run${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function listFlagNames(command: CliCommand, kind: CliFlag['kind']) {
  return command.flags.filter((flag) => flag.kind === kind).map((flag) => `'${flag.name}'`);
}

function serializeLegacyCommand(command: CliCommand) {
  const booleans = listFlagNames(command, 'boolean');
  const strings = listFlagNames(command, 'string');
  const defaults = command.flags.flatMap((flag) =>
    flag.fallback === undefined ? [] : [`${flag.name}: ${flag.fallback}`]
  );
  const options = [
    booleans.length > 0 ? `boolean: [${booleans.join(', ')}]` : null,
    strings.length > 0 ? `string: [${strings.join(', ')}]` : null,
    defaults.length > 0 ? `default: { ${defaults.join(', ')} }` : null,
  ].filter((option) => option !== null);
  const action = resolveActionName(command.name);
  return [
    `import { ${action} } from '../../actions/${command.name}';`,
    "import { parseFlags } from '../parse-flags';",
    '',
    `export const description = '${command.summary}';`,
    '',
    'export async function run(argv: string[]) {',
    `  const flags = parseFlags(argv, ${options.length > 0 ? `{ ${options.join(', ')} }` : '{}'});`,
    `  await ${action}(flags);`,
    '}',
    '',
  ].join('\n');
}

function serializeCommandFlag(flag: CliFlag) {
  const options = flag.fallback === undefined ? '' : `, { default: ${flag.fallback} }`;
  return `    ${flag.name}: flag.${flag.kind}('${flag.help}'${options}),`;
}

function serializeCommand(command: CliCommand) {
  const ordered = [
    ...command.flags.filter((flag) => flag.kind === 'string'),
    ...command.flags.filter((flag) => flag.kind === 'boolean'),
  ];
  const flags = ordered.length > 0 ? `\n${ordered.map(serializeCommandFlag).join('\n')}\n  ` : '';
  const action = resolveActionName(command.name);
  return [
    `import { ${action} } from '../../actions/${command.name}';`,
    "import { defineCommand, flag } from '../registry';",
    '',
    'export default defineCommand({',
    `  name: '${command.name}',`,
    `  summary: '${command.summary}',`,
    `  flags: {${flags}},`,
    `  run: ({ flags }) => ${action}(flags),`,
    '});',
    '',
  ].join('\n');
}

function listCliNames() {
  return [...CLI_COMMANDS.map((command) => command.name), ...HAND_PORTED].sort();
}

function serializeLegacyIndex() {
  return `${listCliNames()
    .map((name) => `export * as ${resolveCamelName(name)} from './${name}';`)
    .join('\n')}\n`;
}

function serializeCommandIndex() {
  const names = listCliNames();
  return [
    ...names.map((name) => `import ${resolveCamelName(name)} from './${name}';`),
    "import type { CommandDefinition } from '../registry';",
    '',
    'export const COMMANDS: readonly CommandDefinition[] = [',
    ...names.map((name) => `  ${resolveCamelName(name)},`),
    '];',
    '',
  ].join('\n');
}

function serializeFlagHelp() {
  const entries = CLI_COMMANDS.flatMap((command) =>
    command.flags.map((flag) => [`${command.name}.${flag.name}`, flag.help] as const)
  );
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

export const CLI_PATHS = {
  registry: 'src/cli/registry.ts',
  suggest: 'src/cli/suggest.ts',
  help: 'src/cli/help.ts',
  index: 'src/cli/index.ts',
  commands: 'src/cli/commands/index.ts',
  push: 'src/cli/commands/push.ts',
  deploy: 'src/cli/commands/deploy.ts',
  codemod: 'scripts/codemods/define-command.ts',
  docs: 'scripts/generate-command-docs.ts',
  mcp: 'src/mcp/commands.ts',
  test: 'src/cli/help.test.ts',
};

function listCliFiles(serialize: (command: CliCommand) => string) {
  return Object.fromEntries(
    CLI_COMMANDS.map((command) => [`src/cli/commands/${command.name}.ts`, serialize(command)])
  );
}

export function listCliBaseFiles(): Files {
  return {
    ...listCliFiles(serializeLegacyCommand),
    'src/cli/commands/deploy.ts': DEPLOY_BASE,
    'src/cli/commands/login.ts': LOGIN_BASE,
    'src/cli/commands/logs.ts': LOGS_BASE,
    'src/cli/commands/index.ts': serializeLegacyIndex(),
    'src/cli/parse-flags.ts': PARSE_FLAGS_BASE,
    [CLI_PATHS.index]: CLI_INDEX_BASE,
  };
}

export function listCliNewFiles(): Files {
  return {
    ...listCliFiles(serializeCommand),
    [CLI_PATHS.deploy]: DEPLOY_NEW,
    'src/cli/commands/login.ts': LOGIN_NEW,
    'src/cli/commands/logs.ts': LOGS_NEW,
    [CLI_PATHS.commands]: COMMAND_INDEX_NEW,
    [CLI_PATHS.registry]: REGISTRY_NEW,
    [CLI_PATHS.suggest]: SUGGEST_NEW,
    [CLI_PATHS.help]: HELP_NEW,
    [CLI_PATHS.index]: CLI_INDEX_NEW,
    [CLI_PATHS.codemod]: CODEMOD_NEW,
    'scripts/codemods/flag-help.json': serializeFlagHelp(),
    [CLI_PATHS.docs]: DOCS_SCRIPT_NEW,
    [CLI_PATHS.mcp]: MCP_COMMANDS_NEW,
    [CLI_PATHS.test]: HELP_TEST_NEW,
  };
}

export const PUSH_NEW = serializeCommand(CLI_COMMANDS[0] as CliCommand);

export const COMMAND_INDEX_NEW = serializeCommandIndex();
