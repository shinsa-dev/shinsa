import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from 'effect/http-api';
import { Changelog } from '../changelog/schema.ts';
import { SlackChannels } from '../slack/schema.ts';
import {
  EditConflictWire,
  FileNotFoundWire,
  RequestFailedWire,
  resolveEngineFailureWire as wire,
} from './errors.ts';
import {
  AccountLoginRequest,
  AccountsAnswer,
  ActivityAnswer,
  AnyBody,
  ATTACHMENT_UPLOAD_LIMIT_BYTES,
  BodyTooLarge,
  BROWSER_ONLY_INSTALL,
  BROWSER_ONLY_TERMINALS,
  BrowserCopyAnswer,
  BrowserOnlyRoute,
  BrowserProjectAnswer,
  BrowserSourceSitesAnswer,
  BrowserSourcesAnswer,
  Bytes,
  ChatAnswer,
  ChatQuery,
  CodeQuery,
  CodeUnavailable,
  CommandAnswer,
  CommandHeaders,
  ContentTypeInvalid,
  CoverageAnswer,
  DelegationsAnswer,
  DelegationsQuery,
  DiffAnswer,
  EmptyBody,
  EngineFeatureRoute,
  ExtensionsAnswer,
  FeedbackAnswer,
  Field,
  FileContentAnswer,
  FileMissing,
  FileWrittenAnswer,
  FlowAnswer,
  GuestRoute,
  HealthAnswer,
  InspectReadOnly,
  LocalOnly,
  LocalOnlyRoute,
  LocalReposAnswer,
  InitiativeSheetAnswer,
  InitiativesAnswer,
  MemoryAnswer,
  ModelsAnswer,
  ObjectAnswer,
  OkAnswer,
  OnboardingAnswer,
  OpenAnswer,
  OpenRequest,
  OwnerOnlyRoute,
  SharedMemberRoute,
  GitHubTokenAnswer,
  PlacementAnswerBody,
  ProjectAnswer,
  ProjectPathBody,
  ProjectsAnswer,
  ProvidersAnswer,
  QueueAnswer,
  RefreshQuery,
  RemoteAnswer,
  RemoteDeviceBody,
  RemoteGrantBody,
  RemoteShareBody,
  RemoteMemberBody,
  RemoteRequestBody,
  RepoAnswer,
  RepoPathsAnswer,
  RepoTreeAnswer,
  ReposAnswer,
  RequestBodyLimit,
  RequestForbidden,
  RestartAnswer,
  RestartRequest,
  RootsAnswer,
  RouteFieldFailures,
  RouteNotFound,
  SchedulesAnswer,
  NotMachineOwner,
  ScopeRefused,
  SearchAnswer,
  ServiceSuggestionsAnswer,
  ServiceRunBody,
  ServiceSuggestionsQuery,
  SettingsAnswer,
  SignInAnswer,
  SlackAnswer,
  TaskDetailAnswer,
  TaskListQuery,
  TaskParams,
  TaskRefsAnswer,
  TasksAnswer,
  TEAM_FAILURE,
  TEAM_USER_FAILURE,
  TeamBody,
  TeamCreateAnswer,
  TeamCreateBody,
  TeamJoinAnswer,
  TeamJoinBody,
  TeamKeysAnswer,
  TeamLinkAnswer,
  TeamKeyDecisionBody,
  TeamMemberBody,
  TeamExtraBody,
  TeamScopesBody,
  TeamRelaysAnswer,
  TeamTasksAnswer,
  TeamTasksQuery,
  TerminalsAnswer,
  UpdateAnswer,
  UserCommandBody,
  VersionsAnswer,
  WebhookAnswer,
  WildcardParams,
  WorktreeMissing,
  WorktreeUsageAnswer,
} from './schema.ts';

export class EngineGate extends HttpApiMiddleware.Service<EngineGate>()('shinsa/core/engine-api/EngineGate', {
  error: [
    RequestFailedWire,
    wire(RouteNotFound),
    wire(RequestForbidden),
    wire(ContentTypeInvalid),
    wire(BodyTooLarge),
    wire(InspectReadOnly),
    wire(LocalOnly),
    wire(ScopeRefused),
    wire(NotMachineOwner),
  ],
}) {}

const Binary = Bytes.pipe(HttpApiSchema.asUint8Array());

const CODE_FAILURES = [wire(CodeUnavailable)];

const codeRead = <const Name extends string, const Path extends string, S extends Schema.Top>(
  name: Name,
  path: Path,
  success: S
) =>
  HttpApiEndpoint.get(name, `/api/tasks/:taskRef/${path}`, {
    params: TaskParams,
    query: CodeQuery,
    success,
    error: CODE_FAILURES,
  }).annotate(GuestRoute, 'own_task');

class TasksGroup extends HttpApiGroup.make('tasks')
  .add(
    HttpApiEndpoint.get('list', '/api/tasks', { query: TaskListQuery, success: TasksAnswer }),
    HttpApiEndpoint.get('read', '/api/tasks/:taskRef', {
      params: TaskParams,
      success: TaskDetailAnswer,
    }).annotate(GuestRoute, 'own_task'),
    HttpApiEndpoint.get('chat', '/api/tasks/:taskRef/chat', {
      params: TaskParams,
      query: ChatQuery,
      success: ChatAnswer,
    }).annotate(GuestRoute, 'own_task'),
    HttpApiEndpoint.post('open', '/api/tasks/:taskRef/open', {
      params: TaskParams,
      payload: OpenRequest,
      success: OpenAnswer,
      error: wire(WorktreeMissing),
    })
      .annotate(LocalOnlyRoute, true)
      .annotate(RouteFieldFailures, {
        target: { code: 'target_invalid', message: 'Pick the editor, Finder or Terminal.' },
      }),
    HttpApiEndpoint.post('writeFile', '/api/tasks/:taskRef/file', {
      params: TaskParams,
      payload: Schema.Struct({ path: Field, content: Field, base: Field }),
      success: FileWrittenAnswer,
      error: EditConflictWire,
    })
  )
  .middleware(EngineGate) {}

class CodeGroup extends HttpApiGroup.make('code')
  .add(
    codeRead('refs', 'refs', TaskRefsAnswer),
    codeRead('paths', 'paths', RepoPathsAnswer),
    codeRead('tree', 'tree', RepoTreeAnswer),
    codeRead('blob', 'blob', FileContentAnswer),
    HttpApiEndpoint.get('raw', '/api/tasks/:taskRef/raw', {
      params: TaskParams,
      query: CodeQuery,
      success: Binary,
      error: [...CODE_FAILURES, wire(FileMissing)],
    }).annotate(GuestRoute, 'own_task'),
    codeRead('search', 'search', SearchAnswer),
    codeRead('diff', 'diff', DiffAnswer)
  )
  .middleware(EngineGate) {}

class CommandsGroup extends HttpApiGroup.make('commands')
  .add(
    HttpApiEndpoint.post('send', '/api/commands', {
      headers: CommandHeaders,
      payload: UserCommandBody,
      success: CommandAnswer,
    }).annotate(RouteFieldFailures, {
      'idempotency-key': {
        code: 'idempotency_key_invalid',
        message: 'The Idempotency-Key header is too long.',
      },
    })
  )
  .middleware(EngineGate) {}

class ServerGroup extends HttpApiGroup.make('server')
  .add(
    HttpApiEndpoint.get('health', '/api/health', { success: HealthAnswer }).annotate(GuestRoute, 'any'),
    HttpApiEndpoint.post('restart', '/api/engine/restart', {
      payload: RestartRequest,
      success: RestartAnswer,
    })
      .annotate(OwnerOnlyRoute, true)
      .annotate(RouteFieldFailures, {
        when: { code: 'when_invalid', message: 'Restart now or once agents are idle.' },
      }),
    HttpApiEndpoint.get('models', '/api/models', { success: ModelsAnswer }),
    HttpApiEndpoint.get('providers', '/api/providers', { success: ProvidersAnswer }),
    HttpApiEndpoint.get('queue', '/api/queue', { success: QueueAnswer })
  )
  .middleware(EngineGate) {}

class FilesGroup extends HttpApiGroup.make('files')
  .add(
    HttpApiEndpoint.get('evidence', '/api/evidence/*', {
      params: WildcardParams,
      success: Binary,
      error: FileNotFoundWire,
    }).annotate(GuestRoute, 'task_file'),
    HttpApiEndpoint.post('uploadAttachment', '/api/attachments', {
      payload: Schema.Struct({ name: Field, mimeType: Field, data: Field }),
      success: ObjectAnswer,
    }).annotate(RequestBodyLimit, ATTACHMENT_UPLOAD_LIMIT_BYTES),
    HttpApiEndpoint.get('attachment', '/api/attachments/*', {
      params: WildcardParams,
      success: Binary,
      error: FileNotFoundWire,
    }).annotate(GuestRoute, 'task_file')
  )
  .middleware(EngineGate) {}

class StateGroup extends HttpApiGroup.make('state')
  .add(
    HttpApiEndpoint.get('settings', '/api/settings', { success: SettingsAnswer }),
    HttpApiEndpoint.get('repos', '/api/repos', { success: ReposAnswer }),
    HttpApiEndpoint.get('projects', '/api/projects', { success: ProjectsAnswer }),
    HttpApiEndpoint.get('schedules', '/api/schedules', { success: SchedulesAnswer }),
    HttpApiEndpoint.get('memory', '/api/memory', { success: MemoryAnswer }),
    HttpApiEndpoint.get('initiatives', '/api/initiatives', { success: InitiativesAnswer }).annotate(
      EngineFeatureRoute,
      'initiatives'
    ),
    HttpApiEndpoint.get('initiative', '/api/initiatives/:initiativeRef', {
      params: { initiativeRef: Schema.String },
      success: InitiativeSheetAnswer,
    }).annotate(EngineFeatureRoute, 'initiatives'),
    HttpApiEndpoint.get('feedback', '/api/feedback', { success: FeedbackAnswer }).annotate(
      EngineFeatureRoute,
      'feedback'
    ),
    HttpApiEndpoint.get('delegations', '/api/delegations', {
      query: DelegationsQuery,
      success: DelegationsAnswer,
    }),
    HttpApiEndpoint.get('activity', '/api/activity', { success: ActivityAnswer })
  )
  .middleware(EngineGate) {}

class OnboardingGroup extends HttpApiGroup.make('onboarding')
  .add(
    HttpApiEndpoint.get('status', '/api/onboarding', { success: OnboardingAnswer }),
    HttpApiEndpoint.get('roots', '/api/onboarding/roots', { query: RefreshQuery, success: RootsAnswer }),
    HttpApiEndpoint.post('setup', '/api/onboarding/setup', {
      payload: AnyBody,
      success: OnboardingAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('worktrees', '/api/onboarding/worktrees', {
      payload: AnyBody,
      success: OnboardingAnswer,
    })
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'worktree-root'),
    HttpApiEndpoint.get('worktreeUsage', '/api/onboarding/worktrees/usage', {
      success: WorktreeUsageAnswer,
    }).annotate(EngineFeatureRoute, 'worktree-root'),
    HttpApiEndpoint.get('prerequisites', '/api/onboarding/prerequisites', { success: ObjectAnswer }),
    HttpApiEndpoint.post('privacy', '/api/onboarding/privacy', {
      payload: EmptyBody,
      success: ObjectAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('install', '/api/onboarding/install', { payload: AnyBody, success: ObjectAnswer })
      .annotate(LocalOnlyRoute, true)
      .annotate(BrowserOnlyRoute, BROWSER_ONLY_INSTALL),
    HttpApiEndpoint.get('flow', '/api/onboarding/flow', { success: FlowAnswer }),
    HttpApiEndpoint.post('reply', '/api/onboarding/flow', { payload: AnyBody, success: FlowAnswer }).annotate(
      OwnerOnlyRoute,
      true
    )
  )
  .middleware(EngineGate) {}

class AccountsGroup extends HttpApiGroup.make('accounts')
  .add(
    HttpApiEndpoint.post('refresh', '/api/accounts/refresh', {
      payload: Schema.Struct({ scope: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('login', '/api/accounts/login', {
      payload: AccountLoginRequest,
      success: AccountsAnswer,
    }).annotate(RouteFieldFailures, {
      accountId: { code: 'account_invalid', message: 'Name the account to sign in to.' },
    }),
    HttpApiEndpoint.post('loginCode', '/api/accounts/login/code', {
      payload: Schema.Struct({ loginId: Field, code: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('loginCancel', '/api/accounts/login/cancel', {
      payload: Schema.Struct({ loginId: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('import', '/api/accounts/import', {
      payload: Schema.Struct({ origin: Field, email: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('update', '/api/accounts/update', {
      payload: Schema.Struct({ accountId: Field, patch: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('remove', '/api/accounts/remove', {
      payload: Schema.Struct({ accountId: Field }),
      success: AccountsAnswer,
    }),
    HttpApiEndpoint.post('provider', '/api/accounts/provider', {
      payload: Schema.Struct({ provider: Field, choice: Field }),
      success: AccountsAnswer,
    }).annotate(EngineFeatureRoute, 'accounts.provider_choice')
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .annotateEndpoints(SharedMemberRoute, true)
  .add(HttpApiEndpoint.get('list', '/api/accounts', { success: AccountsAnswer }))
  .middleware(EngineGate) {}

class SecretsGroup extends HttpApiGroup.make('secrets')
  .add(
    HttpApiEndpoint.get('webhook', '/api/schedules/:scheduleId/webhook', {
      params: { scheduleId: Schema.String },
      success: WebhookAnswer,
    }),
    HttpApiEndpoint.post('writeWebhookSecret', '/api/schedules/:scheduleId/webhook', {
      params: { scheduleId: Schema.String },
      payload: Schema.Struct({ secret: Field }),
      success: WebhookAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('answer', '/api/secrets/:gateId', {
      params: { gateId: Schema.String },
      payload: Schema.Struct({ decline: Field, value: Field }),
      success: OkAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.get('githubToken', '/api/github-token', { success: GitHubTokenAnswer })
      .annotate(OwnerOnlyRoute, true)
      .annotate(SharedMemberRoute, true)
      .annotate(EngineFeatureRoute, 'shared-machine'),
    HttpApiEndpoint.post('writeGitHubToken', '/api/github-token', {
      payload: Schema.Struct({ token: Field }),
      success: GitHubTokenAnswer,
    })
      .annotate(OwnerOnlyRoute, true)
      .annotate(SharedMemberRoute, true)
      .annotate(EngineFeatureRoute, 'shared-machine')
  )
  .middleware(EngineGate) {}

class ExtensionsGroup extends HttpApiGroup.make('extensions')
  .add(
    HttpApiEndpoint.post('check', '/api/extensions/check', {
      payload: Schema.Struct({ serverId: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('addServer', '/api/extensions/servers/add', {
      payload: Schema.Struct({ server: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('updateServer', '/api/extensions/servers/update', {
      payload: Schema.Struct({ serverId: Field, server: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('removeServer', '/api/extensions/servers/remove', {
      payload: Schema.Struct({ serverId: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('chooseServer', '/api/extensions/servers/choose', {
      payload: AnyBody,
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('signIn', '/api/extensions/servers/sign-in', {
      payload: Schema.Struct({ serverId: Field }),
      success: SignInAnswer,
    }).annotate(LocalOnlyRoute, true),
    HttpApiEndpoint.post('signOut', '/api/extensions/servers/sign-out', {
      payload: Schema.Struct({ serverId: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('chooseSkill', '/api/extensions/skills/choose', {
      payload: Schema.Struct({ skillId: Field, enabled: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('choosePlugin', '/api/extensions/plugins/choose', {
      payload: Schema.Struct({ pluginId: Field, enabled: Field }),
      success: ExtensionsAnswer,
    }),
    HttpApiEndpoint.post('optimizer', '/api/extensions/optimizer', {
      payload: AnyBody,
      success: ExtensionsAnswer,
    })
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .add(HttpApiEndpoint.get('snapshot', '/api/extensions', { success: ExtensionsAnswer }))
  .middleware(EngineGate) {}

class VersionsGroup extends HttpApiGroup.make('versions')
  .add(
    HttpApiEndpoint.get('snapshot', '/api/versions', { success: VersionsAnswer }),
    HttpApiEndpoint.post('refresh', '/api/versions/refresh', { payload: EmptyBody, success: VersionsAnswer }),
    HttpApiEndpoint.post('update', '/api/versions/update', {
      payload: Schema.Struct({ program: Field }),
      success: UpdateAnswer,
    }).annotate(OwnerOnlyRoute, true)
  )
  .middleware(EngineGate) {}

class ChangelogGroup extends HttpApiGroup.make('changelog')
  .add(
    HttpApiEndpoint.get('list', '/api/changelog', { success: Changelog }).annotate(
      EngineFeatureRoute,
      'changelog'
    )
  )
  .middleware(EngineGate) {}

class RemoteGroup extends HttpApiGroup.make('remote')
  .add(
    HttpApiEndpoint.post('createLink', '/api/remote/link/create', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }),
    HttpApiEndpoint.post('removeLink', '/api/remote/link/remove', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }),
    HttpApiEndpoint.post('grantMember', '/api/remote/members/grant', {
      payload: RemoteGrantBody,
      success: RemoteAnswer,
    })
      .annotate(EngineFeatureRoute, 'teams')
      .annotate(RouteFieldFailures, {
        userId: { code: 'userId_invalid', message: 'Name the teammate by their GitHub id.' },
        teamId: { code: 'teamId_invalid', message: 'Name the team you share with them.' },
      }),
    HttpApiEndpoint.post('shareMachine', '/api/remote/teams/share', {
      payload: RemoteShareBody,
      success: RemoteAnswer,
    })
      .annotate(EngineFeatureRoute, 'shared-machine')
      .annotate(RouteFieldFailures, {
        teamId: { code: 'teamId_invalid', message: 'Name the team to share this machine with.' },
        shared: { code: 'shared_invalid', message: 'Say whether the machine is shared, true or false.' },
      }),
    HttpApiEndpoint.post('removeMember', '/api/remote/members/remove', {
      payload: RemoteMemberBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, {
      userId: { code: 'userId_invalid', message: 'Name the member to remove by their GitHub id.' },
    }),
    HttpApiEndpoint.post('removeDevice', '/api/remote/devices/remove', {
      payload: RemoteDeviceBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, {
      publicKey: { code: 'publicKey_invalid', message: 'Name the device to remove by its key.' },
    })
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .add(
    HttpApiEndpoint.post('pair', '/api/remote/pair', { payload: EmptyBody, success: RemoteAnswer }).annotate(
      LocalOnlyRoute,
      true
    ),
    HttpApiEndpoint.post('cancelPairing', '/api/remote/pair/cancel', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }).annotate(LocalOnlyRoute, true),
    HttpApiEndpoint.post('enable', '/api/remote/enable', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }).annotate(LocalOnlyRoute, true),
    HttpApiEndpoint.post('disable', '/api/remote/disable', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }).annotate(LocalOnlyRoute, true),
    HttpApiEndpoint.post('remove', '/api/remote/remove', {
      payload: EmptyBody,
      success: RemoteAnswer,
    }).annotate(LocalOnlyRoute, true)
  )
  .add(
    HttpApiEndpoint.get('snapshot', '/api/remote', { success: RemoteAnswer }),
    HttpApiEndpoint.post('acceptRequest', '/api/remote/requests/accept', {
      payload: RemoteRequestBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, {
      requestId: { code: 'requestId_invalid', message: 'Name the access request to accept.' },
    }),
    HttpApiEndpoint.post('declineRequest', '/api/remote/requests/decline', {
      payload: RemoteRequestBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, {
      requestId: { code: 'requestId_invalid', message: 'Name the access request to decline.' },
    })
  )
  .middleware(EngineGate) {}

const TEAM_FAILURES = { teamId: TEAM_FAILURE };

const TEAM_MEMBER_FAILURES = { teamId: TEAM_FAILURE, userId: TEAM_USER_FAILURE };

class TeamsGroup extends HttpApiGroup.make('teams')
  .add(
    HttpApiEndpoint.post('create', '/api/remote/teams/create', {
      payload: TeamCreateBody,
      success: TeamCreateAnswer,
    }).annotate(RouteFieldFailures, { name: { code: 'name_invalid', message: 'Give the team a name.' } }),
    HttpApiEndpoint.post('link', '/api/remote/teams/link', {
      payload: TeamBody,
      success: TeamLinkAnswer,
    }).annotate(RouteFieldFailures, TEAM_FAILURES),
    HttpApiEndpoint.post('renewLink', '/api/remote/teams/link/renew', {
      payload: TeamBody,
      success: TeamLinkAnswer,
    }).annotate(RouteFieldFailures, TEAM_FAILURES),
    HttpApiEndpoint.post('removeLink', '/api/remote/teams/link/remove', {
      payload: TeamBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_FAILURES),
    HttpApiEndpoint.post('acceptRequest', '/api/remote/teams/requests/accept', {
      payload: TeamMemberBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_MEMBER_FAILURES),
    HttpApiEndpoint.post('declineRequest', '/api/remote/teams/requests/decline', {
      payload: TeamMemberBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_MEMBER_FAILURES),
    HttpApiEndpoint.post('removeMember', '/api/remote/teams/members/remove', {
      payload: TeamMemberBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_MEMBER_FAILURES),
    HttpApiEndpoint.post('leave', '/api/remote/teams/leave', {
      payload: TeamBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_FAILURES),
    HttpApiEndpoint.post('remove', '/api/remote/teams/remove', {
      payload: TeamBody,
      success: RemoteAnswer,
    }).annotate(RouteFieldFailures, TEAM_FAILURES),
    HttpApiEndpoint.post('join', '/api/remote/teams/join', {
      payload: TeamJoinBody,
      success: TeamJoinAnswer,
    }).annotate(RouteFieldFailures, { url: { code: 'url_invalid', message: 'Paste the team link.' } })
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .add(HttpApiEndpoint.get('tasks', '/api/teams/tasks', { query: TeamTasksQuery, success: TeamTasksAnswer }))
  .annotateEndpoints(EngineFeatureRoute, 'teams')
  .add(
    HttpApiEndpoint.post('scopes', '/api/remote/teams/scopes', {
      payload: TeamScopesBody,
      success: RemoteAnswer,
    })
      .annotate(RouteFieldFailures, TEAM_FAILURES)
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-access'),
    HttpApiEndpoint.post('extra', '/api/remote/teams/extra', {
      payload: TeamExtraBody,
      success: RemoteAnswer,
    })
      .annotate(RouteFieldFailures, TEAM_MEMBER_FAILURES)
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-access'),
    HttpApiEndpoint.get('keys', '/api/remote/teams/keys', { success: TeamKeysAnswer })
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-access'),
    HttpApiEndpoint.get('relays', '/api/teams/relays', { success: TeamRelaysAnswer })
      .annotate(LocalOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-relay'),
    HttpApiEndpoint.post('requestKey', '/api/remote/teams/key/request', {
      payload: TeamBody,
      success: RemoteAnswer,
    })
      .annotate(RouteFieldFailures, TEAM_FAILURES)
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-keys'),
    HttpApiEndpoint.post('answerKey', '/api/remote/teams/key/answer', {
      payload: TeamKeyDecisionBody,
      success: RemoteAnswer,
    })
      .annotate(RouteFieldFailures, TEAM_FAILURES)
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'team-keys')
  )
  .middleware(EngineGate) {}

class PlacementGroup extends HttpApiGroup.make('placement')
  .add(HttpApiEndpoint.post('ask', '/api/placement', { payload: AnyBody, success: PlacementAnswerBody }))
  .middleware(EngineGate) {}

class SlackGroup extends HttpApiGroup.make('slack')
  .add(
    HttpApiEndpoint.get('snapshot', '/api/slack', { success: SlackAnswer }),
    HttpApiEndpoint.post('disconnect', '/api/slack/disconnect', {
      payload: EmptyBody,
      success: SlackAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.get('channels', '/api/slack/channels', { success: SlackChannels })
      .annotate(OwnerOnlyRoute, true)
      .annotate(EngineFeatureRoute, 'slack-channel-triggers')
  )
  .middleware(EngineGate) {}

class ProjectsGroup extends HttpApiGroup.make('projects')
  .add(
    HttpApiEndpoint.get('localRepos', '/api/repos/local', { success: LocalReposAnswer }),
    HttpApiEndpoint.get('coverage', '/api/repos/coverage', { success: CoverageAnswer }),
    HttpApiEndpoint.post('addRepo', '/api/projects/:projectId/repos', {
      params: { projectId: Schema.String },
      payload: ProjectPathBody,
      success: RepoAnswer,
    }),
    HttpApiEndpoint.post('addFolder', '/api/projects/:projectId/folders', {
      params: { projectId: Schema.String },
      payload: ProjectPathBody,
      success: ProjectAnswer,
    })
  )
  .middleware(EngineGate) {}

const TerminalParams = { terminalId: Schema.String };

const ServiceParams = { serviceId: Schema.String };

class TerminalsGroup extends HttpApiGroup.make('terminals')
  .add(
    HttpApiEndpoint.get('list', '/api/terminals', { success: TerminalsAnswer }).annotate(
      GuestRoute,
      'filtered'
    ),
    HttpApiEndpoint.get('foreground', '/api/terminals/:terminalId/foreground', {
      params: TerminalParams,
      success: ObjectAnswer,
    }),
    HttpApiEndpoint.post('create', '/api/terminals', {
      payload: Schema.Struct({ projectId: Field, path: Field, command: Field, taskId: Field }),
      success: TerminalsAnswer,
    }).annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS),
    HttpApiEndpoint.post('reorder', '/api/terminals/order', {
      payload: Schema.Struct({ projectId: Field, ids: Field }),
      success: TerminalsAnswer,
    }).annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS),
    HttpApiEndpoint.post('rename', '/api/terminals/:terminalId/rename', {
      params: TerminalParams,
      payload: Schema.Struct({ name: Field }),
      success: TerminalsAnswer,
    }).annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS),
    HttpApiEndpoint.post('restart', '/api/terminals/:terminalId/restart', {
      params: TerminalParams,
      payload: AnyBody,
      success: TerminalsAnswer,
    }).annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS),
    HttpApiEndpoint.post('close', '/api/terminals/:terminalId/close', {
      params: TerminalParams,
      payload: AnyBody,
      success: TerminalsAnswer,
    }).annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS)
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .middleware(EngineGate) {}

class ServicesGroup extends HttpApiGroup.make('services')
  .add(
    HttpApiEndpoint.get('suggestions', '/api/services/suggestions', {
      query: ServiceSuggestionsQuery,
      success: ServiceSuggestionsAnswer,
    }).annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('add', '/api/services', { payload: AnyBody, success: TerminalsAnswer })
      .annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS)
      .annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('addBatch', '/api/services/batch', {
      payload: Schema.Struct({ projectId: Field, services: Field }),
      success: TerminalsAnswer,
    })
      .annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS)
      .annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('remove', '/api/services/remove', {
      payload: Schema.Struct({ ids: Field }),
      success: TerminalsAnswer,
    })
      .annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS)
      .annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('startAll', '/api/services/start-all', {
      payload: Schema.Struct({ projectId: Field }),
      success: TerminalsAnswer,
    }),
    HttpApiEndpoint.post('update', '/api/services/:serviceId/update', {
      params: ServiceParams,
      payload: AnyBody,
      success: TerminalsAnswer,
    })
      .annotate(BrowserOnlyRoute, BROWSER_ONLY_TERMINALS)
      .annotate(OwnerOnlyRoute, true),
    HttpApiEndpoint.post('start', '/api/services/:serviceId/start', {
      params: ServiceParams,
      payload: [ServiceRunBody, Schema.Null],
      success: ObjectAnswer,
    }),
    HttpApiEndpoint.post('stop', '/api/services/:serviceId/stop', {
      params: ServiceParams,
      payload: [ServiceRunBody, Schema.Null],
      success: ObjectAnswer,
    }),
    HttpApiEndpoint.post('restart', '/api/services/:serviceId/restart', {
      params: ServiceParams,
      payload: [ServiceRunBody, Schema.Null],
      success: ObjectAnswer,
    })
  )
  .middleware(EngineGate) {}

const BrowserProjectParams = { projectId: Schema.String };

class BrowserGroup extends HttpApiGroup.make('browser')
  .add(
    HttpApiEndpoint.get('project', '/api/browser/projects/:projectId', {
      params: BrowserProjectParams,
      success: BrowserProjectAnswer,
    }),
    HttpApiEndpoint.get('sources', '/api/browser/sources', { success: BrowserSourcesAnswer }),
    HttpApiEndpoint.get('sourceSites', '/api/browser/sources/:sourceId/sites', {
      params: { sourceId: Schema.String },
      success: BrowserSourceSitesAnswer,
    }),
    HttpApiEndpoint.post('copy', '/api/browser/projects/:projectId/copy', {
      params: BrowserProjectParams,
      payload: Schema.Struct({ source: Field, sites: Field }),
      success: BrowserCopyAnswer,
    }),
    HttpApiEndpoint.post('openWindow', '/api/browser/projects/:projectId/window', {
      params: BrowserProjectParams,
      payload: Schema.Struct({ url: Field }),
      success: BrowserProjectAnswer,
    }),
    HttpApiEndpoint.post('closeWindow', '/api/browser/projects/:projectId/window/close', {
      params: BrowserProjectParams,
      payload: EmptyBody,
      success: BrowserProjectAnswer,
    }),
    HttpApiEndpoint.post('removeSite', '/api/browser/projects/:projectId/sites/remove', {
      params: BrowserProjectParams,
      payload: Schema.Struct({ site: Field }),
      success: BrowserProjectAnswer,
    }),
    HttpApiEndpoint.post('signOut', '/api/browser/projects/:projectId/sign-out', {
      params: BrowserProjectParams,
      payload: EmptyBody,
      success: BrowserProjectAnswer,
    })
  )
  .annotateEndpoints(OwnerOnlyRoute, true)
  .annotateEndpoints(EngineFeatureRoute, 'browser')
  .middleware(EngineGate) {}

export class EngineApi extends HttpApi.make('engine').add(
  TasksGroup,
  CodeGroup,
  CommandsGroup,
  ServerGroup,
  FilesGroup,
  StateGroup,
  OnboardingGroup,
  AccountsGroup,
  SecretsGroup,
  ExtensionsGroup,
  VersionsGroup,
  ChangelogGroup,
  RemoteGroup,
  TeamsGroup,
  PlacementGroup,
  SlackGroup,
  ProjectsGroup,
  TerminalsGroup,
  ServicesGroup,
  BrowserGroup
) {}
