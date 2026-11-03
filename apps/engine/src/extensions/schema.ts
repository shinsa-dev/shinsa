import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';
import { type McpServerStatus, type McpSource, OPTIMIZER_LIMITS, type SkillSource } from '@shinsa/core';
import { Duration, Effect, Predicate, Schema } from 'effect';
import { TextList } from '../files/schema.ts';

export class McpServerFailed extends Schema.TaggedError<McpServerFailed, { readonly brand: unique symbol }>()(
  'McpServerFailed',
  { message: Schema.String, unauthorized: Schema.Boolean }
) {}

const McpTransport = Schema.Literals(['stdio', 'http', 'sse']);

const TextRecord = Schema.Record(
  Schema.String,
  Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

export const McpDefinition = Schema.Struct({
  transport: McpTransport,
  command: Schema.NullOr(Schema.String),
  args: Schema.mutable(Schema.Array(Schema.String)),
  env: Schema.Record(Schema.String, Schema.String),
  cwd: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  bearerTokenEnv: Schema.NullOr(Schema.String),
});
export type McpDefinition = typeof McpDefinition.Type;

export type Env = Record<string, string | undefined>;

const LenientText = Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const LenientTexts = Schema.optionalKey(TextList.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const LenientTextRecord = Schema.optionalKey(TextRecord.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const McpEntry = Schema.Struct({
  type: Schema.optionalKey(Schema.Unknown),
  transport: Schema.optionalKey(Schema.Unknown),
  url: LenientText,
  command: LenientText,
  args: LenientTexts,
  env: LenientTextRecord,
  cwd: LenientText,
  headers: Schema.optionalKey(Schema.Unknown),
  http_headers: Schema.optionalKey(Schema.Unknown),
  bearer_token_env_var: LenientText,
  bearerTokenEnv: LenientText,
});
export type McpEntry = typeof McpEntry.Type;

export const Fields = Schema.Record(Schema.String, Schema.Unknown);

export const ExtensionScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('everywhere') }),
  Schema.Struct({ kind: Schema.Literal('project'), project: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('repo'), path: Schema.NonEmptyString }),
]);

const LenientScope = Schema.optionalKey(ExtensionScope.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const StoredServerFields = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  definition: Schema.Unknown,
  enabled: Schema.optionalKey(Schema.Unknown),
  scope: Schema.optionalKey(Schema.Unknown),
});

export interface StoredServer {
  id: string;
  name: string;
  definition: McpDefinition;
  enabled: boolean;
  scope: typeof ExtensionScope.Type;
}

const ServerChoice = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  scope: LenientScope,
});
export type ServerChoice = typeof ServerChoice.Type;

const NullOrText = Schema.NullOr(Schema.String).pipe(
  Schema.catchDecoding(() => Effect.succeedSome(null)),
  Schema.withDecodingDefaultKey(Effect.succeed(null))
);

const NullOrNumber = Schema.NullOr(Schema.Number).pipe(
  Schema.catchDecoding(() => Effect.succeedSome(null)),
  Schema.withDecodingDefaultKey(Effect.succeed(null))
);

export const McpToolInfo = Schema.Struct({ name: Schema.String, description: NullOrText });

const StoredStatus = Schema.Struct({
  state: Schema.Literals(['connected', 'needs_sign_in', 'failing', 'unchecked']),
  error: NullOrText,
  checkedAt: NullOrNumber,
  tools: Schema.optionalKey(
    Schema.Array(Schema.Unknown).pipe(Schema.catchDecoding(() => Effect.succeedNone))
  ),
  tokens: NullOrNumber,
});
export type McpCheckedStatus = Omit<McpServerStatus, 'checkedAt'>;

export const OptimizerDays = Schema.Int.check(
  Schema.isBetween({ minimum: OPTIMIZER_LIMITS.minDays, maximum: OPTIMIZER_LIMITS.maxDays })
);

const ContextOptimizer = Schema.Struct({
  enabled: Schema.Boolean.pipe(
    Schema.catchDecoding(() => Effect.succeedSome(true)),
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  days: OptimizerDays.pipe(
    Schema.catchDecoding(() => Effect.succeedSome(OPTIMIZER_LIMITS.defaultDays)),
    Schema.withDecodingDefaultKey(Effect.succeed(OPTIMIZER_LIMITS.defaultDays))
  ),
  skills: Schema.Boolean.pipe(
    Schema.catchDecoding(() => Effect.succeedSome(true)),
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
});

const Switches = Schema.Record(
  Schema.String,
  Schema.Boolean.pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

const Times = Schema.Record(
  Schema.String,
  Schema.Number.pipe(Schema.catchDecoding(() => Effect.succeedNone))
);

export const ExtensionsFile = Schema.Struct({
  servers: Schema.optionalKey(
    Schema.Array(Schema.Unknown).pipe(Schema.catchDecoding(() => Effect.succeedNone))
  ),
  choices: Schema.optionalKey(
    Schema.Record(Schema.String, ServerChoice.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedNone)
    )
  ),
  skills: Schema.optionalKey(Switches.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  plugins: Schema.optionalKey(Switches.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  statuses: Schema.optionalKey(
    Schema.Record(Schema.String, StoredStatus.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedNone)
    )
  ),
  optimizer: Schema.optionalKey(ContextOptimizer.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  seen: Schema.optionalKey(Times.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export interface ExtensionsSettings {
  version: 1;
  servers: StoredServer[];
  choices: Record<string, ServerChoice>;
  skills: Record<string, boolean>;
  plugins: Record<string, boolean>;
  statuses: Record<string, McpServerStatus>;
  optimizer: typeof ContextOptimizer.Type;
  seen: Record<string, number>;
}

const FileMark = Schema.Struct({ size: Schema.Number, mtimeMs: Schema.Number, offset: Schema.Number });
type FileMark = typeof FileMark.Type;

export const UsageFileFields = Schema.Struct({
  files: Schema.optionalKey(
    Schema.Record(Schema.String, FileMark.pipe(Schema.catchDecoding(() => Effect.succeedNone))).pipe(
      Schema.catchDecoding(() => Effect.succeedNone)
    )
  ),
  servers: Schema.optionalKey(Times.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  labels: Schema.optionalKey(Times.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  skills: Schema.optionalKey(Times.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  readAt: NullOrNumber,
  since: NullOrNumber,
});

export interface UsageFile {
  version: 1;
  files: Record<string, FileMark>;
  servers: Record<string, number>;
  labels: Record<string, number>;
  skills: Record<string, number>;
  readAt: number | null;
  since: number | null;
}

export type UsageSourceKind = 'claude' | 'shinsa';

export interface UsageSource {
  dir: string;
  kind: UsageSourceKind;
}

export interface UsageScan {
  sources: readonly UsageSource[];
  cachePath: string | null;
  now: number;
  horizonDays: number;
  chunkBytes: number;
}

const ToolArgs = Schema.optionalKey(Fields.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const TranscriptToolCall = Schema.Struct({
  type: Schema.Literal('tool_call'),
  at: Schema.Number.pipe(
    Schema.catchDecoding(() => Effect.succeedSome(Number.NaN)),
    Schema.withDecodingDefaultKey(Effect.succeed(Number.NaN))
  ),
  tool: Schema.Struct({
    kind: Schema.optionalKey(Schema.Unknown),
    name: Schema.optionalKey(Schema.Unknown),
    server: Schema.optionalKey(Schema.Unknown),
    args: ToolArgs,
  }),
});

export const TranscriptLine = Schema.fromJsonString(Schema.Unknown);

export interface DiscoveryPaths {
  userHome: string;
  claudeDir: string;
  claudeConfig: string;
  codexHome: string;
  repos: string[];
}

export interface DiscoveredServer {
  id: string;
  name: string;
  source: McpSource;
  origin: string;
  definition: McpDefinition;
  scope: typeof ExtensionScope.Type | null;
  enabled: boolean;
  plugin: string | null;
}

export const PluginManifest = Schema.Struct({
  mcpServers: Schema.optionalKey(Schema.Unknown),
  hooks: Schema.optionalKey(Schema.Unknown),
});
export type PluginManifest = typeof PluginManifest.Type;

export interface ClaudePlugin {
  id: string;
  name: string;
  root: string;
  enabled: boolean;
  manifest: PluginManifest | null;
}

export const ClaudeSettings = Schema.Struct({
  enabledPlugins: Schema.optionalKey(Fields.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export const InstallEntry = Schema.Struct({ installPath: Schema.String });

export const InstalledPlugins = Schema.Struct({
  plugins: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Unknown).pipe(Schema.catchDecoding(() => Effect.succeedSome([])))
  ),
});

const ClaudeProject = Schema.Struct({
  mcpServers: Schema.optionalKey(Schema.Unknown),
  disabledMcpServers: LenientTexts,
  disabledMcpjsonServers: LenientTexts,
});
type ClaudeProject = typeof ClaudeProject.Type;

export const ClaudeConfig = Schema.Struct({
  mcpServers: Schema.optionalKey(Schema.Unknown),
  projects: Schema.optionalKey(
    Schema.Record(Schema.String, ClaudeProject.pipe(Schema.catchDecoding(() => Effect.succeedSome({})))).pipe(
      Schema.catchDecoding(() => Effect.succeedNone)
    )
  ),
});
export type ClaudeConfig = typeof ClaudeConfig.Type;

export const McpJson = Schema.Struct({ mcpServers: Schema.optionalKey(Schema.Unknown) });

export const CodexConfig = Schema.Struct({
  mcp_servers: Schema.optionalKey(Fields.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});

export const CodexServerSwitch = Schema.Struct({ enabled: Schema.Literal(false) });

export interface FoundSkill {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  origin: string;
  plugin: string | null;
  repoPath: string | null;
  path: string;
  claudeName: string | null;
  tokens: number;
}

export interface SkillRoot {
  dir: string;
  source: SkillSource;
  idPrefix: string;
  origin: string;
  plugin: string | null;
  repoPath: string | null;
  claudePrefix: string | null;
}

export interface MarkdownFile {
  entry: string;
  text: string;
}

export interface PluginFiles {
  agents: readonly MarkdownFile[];
  commands: readonly MarkdownFile[];
  hooks: boolean;
}

export interface PluginParts {
  skills: number;
  servers: number;
  skillTokens: number;
}

export interface OpenedClient {
  client: Client;
  stderr: () => string;
  close: () => Promise<void>;
}

const OAuthTokens = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  id_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
  refresh_token: Schema.optionalKey(Schema.String),
});

const OAuthClient = Schema.declare(
  (value): value is OAuthClientInformationMixed =>
    Predicate.hasProperty(value, 'client_id') && Predicate.isString(value.client_id)
);

const OAuthDiscovery = Schema.declare(
  (value): value is OAuthDiscoveryState =>
    Predicate.hasProperty(value, 'authorizationServerUrl') && Predicate.isString(value.authorizationServerUrl)
);

export const StoredCredentials = Schema.Struct({
  client: Schema.optionalKey(OAuthClient.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  clientRedirect: LenientText,
  tokens: Schema.optionalKey(OAuthTokens.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  savedAt: Schema.optionalKey(Schema.Number.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
  verifier: LenientText,
  discovery: Schema.optionalKey(OAuthDiscovery.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
});
export type StoredCredentials = typeof StoredCredentials.Type;

export interface PendingSignIn {
  serverId: string;
  url: string;
  expiresAt: number;
}

export const MCP_CHECK_TIMEOUT = Duration.seconds(15);

const USAGE_MAX_AGE = Duration.minutes(10);

export const USAGE_MAX_AGE_MS = Duration.toMillis(USAGE_MAX_AGE);

export const MCP_HOT_LOAD_TIMEOUT_MS = Duration.toMillis(Duration.seconds(20));

export const MCP_TOOL_CALL_TIMEOUT_MS = Duration.toMillis(Duration.minutes(2));

export const SIGN_IN_PENDING_MS = Duration.toMillis(Duration.minutes(10));

export const TOKEN_REFRESH_MARGIN_MS = Duration.toMillis(Duration.minutes(1));

export const USAGE_HORIZON_DAYS = 90;

export const DAY_MS = 86_400_000;

export const CLAUDE_TOOL_USE =
  /"type":"tool_use","id":"[^"]*","name":"(mcp__[^"]+|Skill)"(?:,"input":\{"skill":"([^"]+)")?/g;

export const SESSION_TIMESTAMP = /"timestamp":"([^"]+)"/;

export const SHINSA_USAGE_MARKERS = ['"kind":"mcp"', '"name":"Skill"'];

export const LOADER_TOOLS = new Set(['load_mcp_server', 'call_mcp_tool']);

export const USAGE_CHUNK_BYTES = 8 * 1024 * 1024;

export const STDERR_LIMIT = 400;

export const TOOL_DESCRIPTION_LIMIT = 200;

export const SIGN_IN_REFUSED = 'The server wants you to sign in.';

export const EXTENSIONS_FILE = 'extensions.json';

export const USAGE_FILE = 'extension-usage.json';
