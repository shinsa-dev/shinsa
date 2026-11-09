import { Context, Predicate, Schema, SchemaGetter } from 'effect';
import type { AgentModel, AgentProviderInfo } from '../agent-models/index.ts';
import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/schema.ts';
import type { Feedback, FeedbackLeak } from '../domain/feedback.ts';
import type { MemoryEntry } from '../domain/memory.ts';
import type { OnBehalfAction } from '../domain/on-behalf.ts';
import type { Schedule, WatchSuggestion } from '../domain/schedules.ts';
import { AutopilotContactPatch, type WebhookSignature } from '../domain/schema.ts';
import type { Settings } from '../domain/settings.ts';
import type { Focus, Gate, Project, Repo, Run, Task, TaskSuggestion } from '../domain/types.ts';
import type { Watchdog } from '../domain/watchdogs.ts';
import type { AccountsSnapshot } from '../protocol/accounts.ts';
import type {
  FileContent,
  FileWritten,
  RepoPaths,
  RepoTree,
  SearchResult,
  TaskRefs,
} from '../protocol/code.ts';
import type { EngineFeature } from '../protocol/engine.ts';
import type { ExtensionsSnapshot } from '../protocol/extensions.ts';
import type { TaskDiff } from '../protocol/messages.ts';
import type {
  OnboardingFlow,
  OnboardingStatus,
  RootSuggestions,
  WorktreeUsage,
} from '../protocol/onboarding.ts';
import type { ServiceSuggestion } from '../protocol/services.ts';
import type { TerminalsSnapshot } from '../protocol/terminals.ts';
import type { UpdateOutcome, VersionsSnapshot } from '../protocol/versions.ts';
import type { QueueSummary } from '../queue/types.ts';
import type { TeamJoinStatus } from '../remote/contract.ts';
import type { PlacementAnswer } from '../remote/placement.ts';
import type { RemoteSnapshot } from '../remote/status.ts';
import type { TeamFeedSnapshot } from '../remote/teams.ts';
import type { MergeStepView } from '../report/merge-steps.ts';
import { AccessScopes } from '../scopes/schema.ts';
import type { SlackDirectoryView, SlackSnapshot } from '../slack/relay.ts';
import type { CoverageDetection } from '../test-coverage/types.ts';

export const ENGINE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_UPLOAD_LIMIT_BYTES = Math.ceil((ATTACHMENT_LIMIT_BYTES * 4) / 3) + 64 * 1024;

export const IDEMPOTENCY_KEY_LIMIT = 200;

export const ROUTE_NOT_FOUND_MESSAGE = 'No such endpoint.';

export const FILE_NOT_FOUND_TEXT = 'Not found';

export const BROWSER_ONLY_TERMINALS = 'Only Shinsa’s page opens terminals.';

export const BROWSER_ONLY_INSTALL = 'Only Shinsa’s own page installs the tools setup checks.';

export const GUEST_ACCESS = ['none', 'any', 'filtered', 'own_task', 'task_file'] as const;

export type GuestAccess = (typeof GUEST_ACCESS)[number];

export interface FieldFailure {
  readonly code: string;
  readonly message: string;
}

export type FieldFailures = Readonly<Record<string, FieldFailure>>;

export const EngineFeatureRoute = Context.Reference<EngineFeature | null>('shinsa/core/engine-api/Feature', {
  defaultValue: () => null,
});

export const LocalOnlyRoute = Context.Reference<boolean>('shinsa/core/engine-api/LocalOnly', {
  defaultValue: () => false,
});

export const OwnerOnlyRoute = Context.Reference<boolean>('shinsa/core/engine-api/OwnerOnly', {
  defaultValue: () => false,
});

export const SharedMemberRoute = Context.Reference<boolean>('shinsa/core/engine-api/SharedMember', {
  defaultValue: () => false,
});

export const GuestRoute = Context.Reference<GuestAccess>('shinsa/core/engine-api/Guest', {
  defaultValue: () => 'none',
});

export const BrowserOnlyRoute = Context.Reference<string | null>('shinsa/core/engine-api/BrowserOnly', {
  defaultValue: () => null,
});

export const RequestBodyLimit = Context.Reference<number>('shinsa/core/engine-api/BodyLimit', {
  defaultValue: () => ENGINE_BODY_LIMIT_BYTES,
});

export const RouteFieldFailures = Context.Reference<FieldFailures>('shinsa/core/engine-api/FieldFailures', {
  defaultValue: () => ({}),
});

export class RequestFailed extends Schema.TaggedError<RequestFailed, { readonly brand: unique symbol }>()(
  'RequestFailed',
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 400 }
) {
  static readonly status = 400;
}

export class RouteNotFound extends Schema.TaggedError<RouteNotFound, { readonly brand: unique symbol }>()(
  'RouteNotFound',
  { message: Schema.String },
  { httpApiStatus: 404 }
) {
  static readonly code = 'not_found';
  static readonly status = 404;
}

export class RequestForbidden extends Schema.TaggedError<
  RequestForbidden,
  { readonly brand: unique symbol }
>()('RequestForbidden', { message: Schema.String }, { httpApiStatus: 403 }) {
  static readonly code = 'forbidden';
  static readonly status = 403;
}

export class ContentTypeInvalid extends Schema.TaggedError<
  ContentTypeInvalid,
  { readonly brand: unique symbol }
>()('ContentTypeInvalid', { message: Schema.String }, { httpApiStatus: 415 }) {
  static readonly code = 'content_type_invalid';
  static readonly status = 415;
}

export class BodyTooLarge extends Schema.TaggedError<BodyTooLarge, { readonly brand: unique symbol }>()(
  'BodyTooLarge',
  { message: Schema.String },
  { httpApiStatus: 413 }
) {
  static readonly code = 'body_too_large';
  static readonly status = 413;
}

export class InspectReadOnly extends Schema.TaggedError<InspectReadOnly, { readonly brand: unique symbol }>()(
  'InspectReadOnly',
  { message: Schema.String },
  { httpApiStatus: 403 }
) {
  static readonly code = 'inspect_read_only';
  static readonly status = 403;
}

export class LocalOnly extends Schema.TaggedError<LocalOnly, { readonly brand: unique symbol }>()(
  'LocalOnly',
  { message: Schema.String },
  { httpApiStatus: 403 }
) {
  static readonly code = 'local_only';
  static readonly status = 403;
}

export class ScopeRefused extends Schema.TaggedError<ScopeRefused, { readonly brand: unique symbol }>()(
  'ScopeRefused',
  { message: Schema.String },
  { httpApiStatus: 403 }
) {
  static readonly code = 'handoff_scope';
  static readonly status = 403;
}

export class NotMachineOwner extends Schema.TaggedError<NotMachineOwner, { readonly brand: unique symbol }>()(
  'NotMachineOwner',
  { message: Schema.String },
  { httpApiStatus: 403 }
) {
  static readonly code = 'not_owner';
  static readonly status = 403;
}

export class ConnectRefused extends Schema.TaggedError<ConnectRefused, { readonly brand: unique symbol }>()(
  'ConnectRefused',
  { message: Schema.String },
  { httpApiStatus: 401 }
) {
  static readonly code = 'unauthorized';
  static readonly status = 401;
}

export class WorktreeMissing extends Schema.TaggedError<WorktreeMissing, { readonly brand: unique symbol }>()(
  'WorktreeMissing',
  { message: Schema.String },
  { httpApiStatus: 404 }
) {
  static readonly code = 'worktree_missing';
  static readonly status = 404;
}

export class CodeUnavailable extends Schema.TaggedError<CodeUnavailable, { readonly brand: unique symbol }>()(
  'CodeUnavailable',
  { message: Schema.String },
  { httpApiStatus: 404 }
) {
  static readonly code = 'code_unavailable';
  static readonly status = 404;
}

export class FileMissing extends Schema.TaggedError<FileMissing, { readonly brand: unique symbol }>()(
  'FileMissing',
  { message: Schema.String },
  { httpApiStatus: 404 }
) {
  static readonly code = 'file_missing';
  static readonly status = 404;
}

export class EditConflict extends Schema.TaggedError<EditConflict, { readonly brand: unique symbol }>()(
  'EditConflict',
  { message: Schema.String, content: Schema.NullOr(Schema.String) },
  { httpApiStatus: 409 }
) {
  static readonly code = 'file_changed';
  static readonly status = 409;
}

export class FileNotFound extends Schema.TaggedError<FileNotFound, { readonly brand: unique symbol }>()(
  'FileNotFound',
  {},
  { httpApiStatus: 404 }
) {
  static readonly status = 404;
}

export const EngineFailureBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});

export type EngineFailureBody = typeof EngineFailureBody.Type;

export const TaskReference = Schema.String;

export const PathParam = Schema.String;

export const WildcardParams = { '*': PathParam };

export const TaskParams = { taskRef: TaskReference };

export const LooseText = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (Predicate.isString(value) && value !== '' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  })
);

export const LooseLine = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.NullOr(Schema.Number), {
    decode: SchemaGetter.transform((value) =>
      Predicate.isNumber(value) && Number.isInteger(value) && value > 0 ? value : null
    ),
    encode: SchemaGetter.transform((value) => value),
  })
);

export const LoosePath = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value) => (Predicate.isString(value) ? value : '')),
    encode: SchemaGetter.transform((value) => value),
  })
);

export const Field = Schema.optionalKey(Schema.Unknown);

export const AnyBody = Schema.Record(Schema.String, Schema.Unknown);

export type AnyBody = typeof AnyBody.Type;

export const EmptyBody = Schema.Struct({});

export const FilledText = Schema.String.check(Schema.makeFilter((value) => value.trim() !== ''));

export const IdempotencyKey = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length <= IDEMPOTENCY_KEY_LIMIT)
);

export const OPEN_TARGETS = ['editor', 'finder', 'terminal'] as const;

export const OpenTarget = Schema.Literals(OPEN_TARGETS);

export type OpenTarget = typeof OpenTarget.Type;

export const OpenRequest = Schema.Struct({
  target: OpenTarget,
  path: Schema.optionalKey(LooseText),
  line: Schema.optionalKey(LooseLine),
});

export type OpenRequest = typeof OpenRequest.Type;

export const RESTART_WHEN = ['now', 'idle'] as const;

export const RestartRequest = Schema.Struct({ when: Schema.Literals(RESTART_WHEN) });

export const AccountLoginRequest = Schema.Struct({
  accountId: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
});

export const UserCommandBody = Schema.Unknown.pipe(
  Schema.refine((value): value is UserCommand => value !== undefined)
);

export const CommandHeaders = { 'idempotency-key': Schema.optionalKey(IdempotencyKey) };

export const TaskListQuery = {
  status: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.String),
};

export const ChatQuery = {
  run: Schema.optionalKey(Schema.String),
  kinds: Schema.optionalKey(Schema.String),
  after: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.String),
};

export const CodeQuery = {
  ref: Schema.optionalKey(Schema.String),
  dir: Schema.optionalKey(Schema.String),
  base: Schema.optionalKey(Schema.String),
  head: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  previous: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  regex: Schema.optionalKey(Schema.String),
  case: Schema.optionalKey(Schema.String),
  word: Schema.optionalKey(Schema.String),
  glob: Schema.optionalKey(Schema.String),
  v: Schema.optionalKey(Schema.String),
};

export const RefreshQuery = { refresh: Schema.optionalKey(Schema.String) };

export const ServiceSuggestionsQuery = {
  projectId: Schema.optionalKey(Schema.String),
  refine: Schema.optionalKey(Schema.String),
};

export const DelegationsQuery = { task: Schema.optionalKey(Schema.String) };

export const TeamTasksQuery = {
  team: Schema.optionalKey(Schema.String),
  open: Schema.optionalKey(Schema.String),
};

export const RemoteRequestBody = Schema.Struct({ requestId: FilledText });

export const RemoteGrantBody = Schema.Struct({ userId: FilledText, teamId: FilledText });

export const RemoteMemberBody = Schema.Struct({ userId: FilledText });

export const RemoteShareBody = Schema.Struct({ teamId: FilledText, shared: Schema.Boolean });

export const RemoteDeviceBody = Schema.Struct({ publicKey: FilledText });

export const TeamCreateBody = Schema.Struct({ name: FilledText });

export const TeamJoinBody = Schema.Struct({ url: FilledText });

export const TeamBody = Schema.Struct({ teamId: FilledText });

export const TeamMemberBody = Schema.Struct({ teamId: FilledText, userId: FilledText });

export const TeamKeyDecisionBody = Schema.Struct({
  teamId: FilledText,
  instanceId: FilledText,
  approve: Schema.Boolean,
});

export const TeamScopesBody = Schema.Struct({
  teamId: FilledText,
  userId: Schema.optionalKey(FilledText),
  scopes: Schema.NullOr(AccessScopes),
});

export const TeamExtraBody = Schema.Struct({ teamId: FilledText, userId: FilledText, scopes: AccessScopes });

export const ProjectPathBody = Schema.Struct({ path: LoosePath });

export const ServiceRunBody = Schema.Struct({ taskId: Field });

export const TEAM_FAILURE: FieldFailure = { code: 'teamId_invalid', message: 'Name the team by its id.' };

export const TEAM_USER_FAILURE: FieldFailure = {
  code: 'userId_invalid',
  message: 'Name the person by their GitHub id.',
};

export const OkAnswer = Schema.Struct({ ok: Schema.Literal(true) });

export const OpenAnswer = Schema.Struct({ ok: Schema.Boolean });

export const CommandAnswer = Schema.Struct({
  ok: Schema.Literal(true),
  taskId: Schema.NullOr(Schema.String),
  handle: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type CommandAnswer = typeof CommandAnswer.Type;

export const RestartAnswer = Schema.Struct({ restarting: Schema.Boolean });

export const TeamLinkAnswer = Schema.Struct({ url: Schema.String });

export const TeamKeysAnswer = Schema.Struct({
  keys: Schema.Array(Schema.Struct({ teamId: Schema.String, name: Schema.String, key: Schema.String })),
});

export const TeamRelayEntry = Schema.Struct({
  instanceId: Schema.String,
  teamId: Schema.String,
  name: Schema.String,
  userId: Schema.String,
  appOrigin: Schema.String,
});

export type TeamRelayEntry = typeof TeamRelayEntry.Type;

export const TeamRelaysAnswer = Schema.Struct({ relays: Schema.Array(TeamRelayEntry) });

export const TeamCreateAnswer = Schema.Struct({ teamId: Schema.String, url: Schema.String });

export const Bytes = Schema.Uint8Array;

export interface TaskPullRequestView {
  readonly number: number;
  readonly state: string;
  readonly checks: unknown;
  readonly url: string;
}

export interface TaskDecisionView {
  readonly gateId: string;
  readonly type: string;
  readonly title: string;
}

export interface TaskView {
  readonly id: string;
  readonly handle: string | null;
  readonly title: string;
  readonly stage: Task['stage'];
  readonly status: string;
  readonly stageReason: string | null;
  readonly priority: Task['priority'];
  readonly mode: string;
  readonly repo: string | null;
  readonly branch: string | null;
  readonly pullRequest: TaskPullRequestView | null;
  readonly decision: TaskDecisionView | null;
  readonly snoozed: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly url: string;
}

export interface RunView {
  readonly id: string;
  readonly role: Run['role'];
  readonly phaseIndex: number | null;
  readonly provider: Run['provider'];
  readonly model: Run['model'];
  readonly startedAt: number;
  readonly endedAt: Run['endedAt'];
  readonly outcome: Run['outcome'];
  readonly summary: Run['summary'];
  readonly account: string | null;
  readonly delegation: {
    readonly title: string;
    readonly parentRunId: string;
    readonly depth: number;
  } | null;
}

export interface TaskDetailView {
  readonly task: TaskView;
  readonly request: string;
  readonly plan: { readonly version: number; readonly approved: boolean; readonly document: unknown } | null;
  readonly summary: Task['summary'];
  readonly result: Task['result'] | null;
  readonly findings: Task['findings'];
  readonly mergeSteps: readonly MergeStepView[];
  readonly watchdogs: readonly Watchdog[];
  readonly gates: readonly Gate[];
  readonly waitsOn: readonly { readonly id: string; readonly title: string }[];
  readonly runs: readonly RunView[];
  readonly suggestions: readonly TaskSuggestion[];
  readonly activity: Task['activity'];
  readonly text: string;
}

export interface ChatPage {
  readonly taskId: string;
  readonly runs: readonly RunView[];
  readonly entries: readonly (ChatEntry & { readonly index: number; readonly runId: string })[];
  readonly next: number | null;
}

export interface DelegationView extends RunView {
  readonly taskId: string;
}

export interface ProjectView extends Project {
  readonly repos: readonly { readonly id: string; readonly name: string; readonly path: string }[];
}

export interface LocalRepoView {
  readonly path: string;
  readonly name: string;
  readonly repoId: string | null;
  readonly projectId: string | null;
}

export interface WebhookView {
  readonly url: string;
  readonly signature: WebhookSignature | null;
  readonly hasSecret: boolean;
  readonly replayKey: string | null;
}

export const ObjectAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is object => Predicate.isObject(value))
);

export const TasksAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly tasks: readonly TaskView[] } => Predicate.isObject(value))
);

export const TaskDetailAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TaskDetailView => Predicate.isObject(value))
);

export const ChatAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is ChatPage => Predicate.isObject(value))
);

export const SettingsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly settings: Settings; readonly keys: readonly string[] } =>
    Predicate.isObject(value)
  )
);

export const ReposAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly repos: readonly Repo[] } => Predicate.isObject(value))
);

export const ProjectsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly projects: readonly ProjectView[]; readonly focus: Focus } =>
    Predicate.isObject(value)
  )
);

export const SchedulesAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (
      value
    ): value is {
      readonly schedules: readonly Schedule[];
      readonly suggestions: readonly WatchSuggestion[];
    } => Predicate.isObject(value)
  )
);

export const MemoryAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (value): value is { readonly memory: readonly (MemoryEntry & { readonly project: string | null })[] } =>
      Predicate.isObject(value)
  )
);

export const FeedbackAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (
      value
    ): value is {
      readonly feedback: readonly (Feedback & {
        readonly task: string | null;
        readonly leaks: readonly FeedbackLeak[];
      })[];
    } => Predicate.isObject(value)
  )
);

export const DelegationsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly delegations: readonly DelegationView[] } =>
    Predicate.isObject(value)
  )
);

export const ActivityAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (
      value
    ): value is { readonly actions: readonly (OnBehalfAction & { readonly byTask: string | null })[] } =>
      Predicate.isObject(value)
  )
);

export const HealthAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (
      value
    ): value is {
      readonly ok: boolean;
      readonly version: string;
      readonly protocol: number;
    } => Predicate.isObject(value)
  )
);

export const ModelsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is readonly AgentModel[] => Array.isArray(value))
);

export const ProvidersAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is readonly AgentProviderInfo[] => Array.isArray(value))
);

export const QueueAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is QueueSummary => Predicate.isObject(value))
);

export const TaskRefsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TaskRefs => Predicate.isObject(value))
);

export const RepoPathsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is RepoPaths => Predicate.isObject(value))
);

export const RepoTreeAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is RepoTree => Predicate.isObject(value))
);

export const FileContentAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is FileContent => Predicate.isObject(value))
);

export const SearchAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is SearchResult => Predicate.isObject(value))
);

export const DiffAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TaskDiff => Predicate.isObject(value))
);

export const FileWrittenAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is FileWritten => Predicate.isObject(value))
);

export const GitHubTokenAnswer = Schema.Struct({
  login: Schema.NullOr(Schema.String),
  saved: Schema.Boolean,
  savedAt: Schema.NullOr(Schema.Number),
  machineLogin: Schema.Boolean,
});
export type GitHubTokenAnswer = typeof GitHubTokenAnswer.Type;

export const AccountsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is AccountsSnapshot => Predicate.isObject(value))
);

export const ExtensionsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is ExtensionsSnapshot => Predicate.isObject(value))
);

export const VersionsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is VersionsSnapshot => Predicate.isObject(value))
);

export const UpdateAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is UpdateOutcome => Predicate.isObject(value))
);

export const RemoteAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is RemoteSnapshot => Predicate.isObject(value))
);

export const TeamJoinAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly status: TeamJoinStatus; readonly teamId: string } =>
    Predicate.isObject(value)
  )
);

export const TeamTasksAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TeamFeedSnapshot => Predicate.isObject(value))
);

export const PlacementAnswerBody = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly answer: PlacementAnswer | null } => Predicate.isObject(value))
);

export const SlackAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is SlackSnapshot => Predicate.isObject(value))
);

export const SlackDirectoryAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is SlackDirectoryView => Predicate.isObject(value))
);

export const SlackDirectoryParams = { teamId: Schema.String };

export const SlackTestBody = Schema.Struct({ contact: AutopilotContactPatch });

export const SlackTestOutcome = Schema.Struct({
  sent: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
});

export type SlackTestOutcome = typeof SlackTestOutcome.Type;

export const SignInAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly authorizationUrl: string | null } => Predicate.isObject(value))
);

export const OnboardingAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is OnboardingStatus => Predicate.isObject(value))
);

export const RootsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is RootSuggestions => Predicate.isObject(value))
);

export const WorktreeUsageAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is WorktreeUsage => Predicate.isObject(value))
);

export const FlowAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is OnboardingFlow => Predicate.isObject(value))
);

export const LocalReposAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly repos: readonly LocalRepoView[] } => Predicate.isObject(value))
);

export const CoverageAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly detected: Readonly<Record<string, CoverageDetection | null>> } =>
    Predicate.isObject(value)
  )
);

export const RepoAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly repo: Repo } => Predicate.isObject(value))
);

export const ProjectAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly project: Project } => Predicate.isObject(value))
);

export const WebhookAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is WebhookView => Predicate.isObject(value))
);

export const TerminalsAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot => Predicate.isObject(value))
);

export const ServiceSuggestionsAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (value): value is { readonly suggestions: readonly ServiceSuggestion[]; readonly refined: boolean } =>
      Predicate.isObject(value)
  )
);

export const SourceBrowserId = Schema.Literals(['dia', 'arc', 'chrome', 'brave', 'edge']);
export type SourceBrowserId = typeof SourceBrowserId.Type;

export const BrowserSite = Schema.Struct({
  site: Schema.String,
  cookies: Schema.Number,
  signedIn: Schema.Boolean,
});
export type BrowserSite = typeof BrowserSite.Type;

export const BrowserProjectAnswer = Schema.Struct({
  mode: Schema.Literals(['stopped', 'headless', 'window']),
  sites: Schema.Array(BrowserSite),
});
export type BrowserProjectAnswer = typeof BrowserProjectAnswer.Type;

export const SourceBrowserAnswer = Schema.Struct({
  id: SourceBrowserId,
  name: Schema.String,
  isDefault: Schema.Boolean,
});
export type SourceBrowserAnswer = typeof SourceBrowserAnswer.Type;

export const BrowserSourcesAnswer = Schema.Struct({ sources: Schema.Array(SourceBrowserAnswer) });
export type BrowserSourcesAnswer = typeof BrowserSourcesAnswer.Type;

export const BrowserSourceSitesAnswer = Schema.Struct({ sites: Schema.Array(BrowserSite) });
export type BrowserSourceSitesAnswer = typeof BrowserSourceSitesAnswer.Type;

export const BrowserCopyAnswer = Schema.Struct({
  copied: Schema.Number,
  skipped: Schema.Number,
  sites: Schema.Array(BrowserSite),
});
export type BrowserCopyAnswer = typeof BrowserCopyAnswer.Type;

export interface EngineRoute {
  readonly group: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly key: string;
  readonly feature: EngineFeature | null;
  readonly localOnly: boolean;
  readonly ownerOnly: boolean;
  readonly sharedMember: boolean;
  readonly guest: GuestAccess;
  readonly browserOnly: string | null;
  readonly bodyLimit: number;
  readonly fieldFailures: FieldFailures;
}
