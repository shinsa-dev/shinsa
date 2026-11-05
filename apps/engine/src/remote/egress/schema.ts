import { ViewScopes } from '@shinsa/core';
import { Schema } from 'effect';

const Data = Schema.Unknown;

const Empty = Schema.Tuple([]);

const SharedPerson = Schema.Struct({
  name: Data,
  avatarUrl: Data,
});

const SharedPullRequest = Schema.Struct({
  number: Data,
  url: Data,
  base: Schema.optionalKey(Data),
  state: Data,
  checks: Data,
  unresolvedComments: Data,
  mergeable: Data,
  headSha: Schema.optionalKey(Data),
  updatedAt: Data,
  checkRuns: Schema.optionalKey(Data),
  unresolvedThreads: Schema.optionalKey(Empty),
  mergeQueue: Schema.optionalKey(Data),
  queueRemoval: Schema.optionalKey(Data),
  mergeCommit: Schema.optionalKey(Data),
  changes: Schema.optionalKey(Data),
});

const SharedUsageWait = Schema.Struct({
  id: Data,
  runId: Data,
  role: Data,
  phaseIndex: Data,
  account: Schema.Null,
  resetAt: Data,
  armedAt: Data,
  autoResume: Data,
  status: Data,
  provider: Schema.optionalKey(Data),
  cause: Schema.optionalKey(Data),
  pace: Schema.optionalKey(Data),
});

const SharedActivity = Schema.Struct({
  at: Data,
  actor: Data,
  kind: Data,
  text: Data,
  detail: Data,
  evidenceId: Data,
  runId: Schema.Null,
  gateType: Schema.optionalKey(Data),
  onBehalf: Schema.optionalKey(Data),
  byGuest: Schema.optionalKey(Data),
  person: Schema.optionalKey(
    Schema.Struct({
      login: Data,
      name: Data,
      avatarUrl: Data,
    })
  ),
  round: Schema.optionalKey(Data),
});

const SharedTaskRecord = Schema.Struct({
  id: Data,
  handle: Data,
  projectId: Data,
  request: Data,
  title: Data,
  repoId: Data,
  size: Data,
  planFirst: Data,
  stage: Data,
  stageReason: Data,
  cancelledFrom: Data,
  priority: Data,
  branch: Data,
  worktreePath: Schema.Null,
  plan: Data,
  phases: Data,
  planAnswers: Schema.Null,
  summary: Data,
  report: Data,
  reviewSummary: Data,
  findings: Data,
  fixRounds: Data,
  fixFor: Schema.Null,
  fixSignature: Schema.Null,
  stalledFixes: Data,
  pushedSha: Data,
  pushedAt: Data,
  recoveries: Data,
  phaseReports: Data,
  checks: Data,
  runningChecks: Data,
  checkResults: Data,
  coverage: Data,
  pullRequest: Schema.NullOr(SharedPullRequest),
  waitsOn: Empty,
  note: Schema.Null,
  origin: Schema.Null,
  createdAt: Data,
  updatedAt: Data,
  stageChangedAt: Data,
  activity: Schema.Array(SharedActivity),
  mode: Schema.optionalKey(Data),
  pipeline: Schema.optionalKey(Data),
  duplicate: Schema.optionalKey(Data),
  reviewDisagreements: Data,
  monitor: Data,
  suggestions: Data,
  usageWait: Schema.NullOr(SharedUsageWait),
  triageDecisions: Data,
  auto: Data,
  result: Data,
  proposal: Data,
  rounds: Data,
  closedAt: Data,
  mergeStepsDone: Data,
  carriedMergeSteps: Data,
  watchdogs: Data,
});

const SharedGate = Schema.Struct({
  id: Data,
  taskId: Data,
  type: Data,
  status: Data,
  title: Data,
  body: Data,
  runId: Data,
  openedAt: Data,
  answeredAt: Data,
  decision: Data,
  response: Schema.Null,
  planVersion: Schema.optionalKey(Data),
  choices: Schema.optionalKey(Data),
  recommendation: Schema.optionalKey(Data),
  cause: Schema.optionalKey(Data),
  escalation: Schema.optionalKey(Data),
  round: Schema.optionalKey(Data),
});

const SharedDelegation = Schema.Struct({
  parentRunId: Data,
  depth: Data,
  requestKey: Data,
  title: Data,
  brief: Schema.Literal(''),
  mode: Data,
  wake: Data,
  isolation: Data,
  baseCommit: Data,
  delivery: Data,
  question: Data,
  requestedAt: Data,
});

const SharedRun = Schema.Struct({
  id: Data,
  taskId: Data,
  role: Data,
  purpose: Schema.optionalKey(Data),
  status: Schema.optionalKey(Data),
  phaseIndex: Data,
  provider: Data,
  model: Data,
  sessionId: Schema.Null,
  startedAt: Data,
  endedAt: Data,
  outcome: Data,
  summary: Schema.Null,
  usage: Schema.optionalKey(Data),
  delegation: Schema.optionalKey(SharedDelegation),
  waitingOn: Schema.optionalKey(Data),
  round: Schema.optionalKey(Data),
});

const SharedEvidence = Schema.Struct({
  id: Data,
  taskId: Data,
  runId: Schema.Null,
  kind: Data,
  title: Data,
  uri: Data,
  attachedAt: Data,
  round: Schema.optionalKey(Data),
  detail: Schema.optionalKey(Data),
  width: Schema.optionalKey(Data),
  theme: Schema.optionalKey(Data),
  stage: Schema.optionalKey(Data),
  itemId: Schema.optionalKey(Data),
  label: Schema.optionalKey(Data),
  checkId: Schema.optionalKey(Data),
  key: Schema.optionalKey(Data),
  fixFor: Schema.optionalKey(Data),
});

const SharedRepo = Schema.Struct({
  id: Data,
  name: Data,
  path: Schema.Literal(''),
  defaultBranch: Data,
  remote: Data,
  projectId: Data,
  checkCommands: Data,
});

const SharedProject = Schema.Struct({
  id: Data,
  name: Data,
  color: Data,
  key: Data,
  description: Schema.Literal(''),
  folders: Empty,
});

const SharedTask = Schema.Struct({
  scopes: ViewScopes,
  task: SharedTaskRecord,
  gates: Schema.Array(SharedGate),
  runs: Schema.Array(SharedRun),
  evidence: Schema.Array(SharedEvidence),
  repo: Schema.NullOr(SharedRepo),
  project: Schema.NullOr(SharedProject),
  owner: Data,
  ownerProfile: Schema.optionalKey(Schema.NullOr(SharedPerson)),
  machine: Data,
  repository: Data,
  description: Data,
  update: Data,
  code: Data,
});

const ShareView = Schema.Struct({
  shared: SharedTask,
  files: Schema.Record(Schema.String, Schema.Struct({ version: Data, type: Data })),
  updatedAt: Data,
});

const TeamHolder = Schema.Struct({ login: Data, name: Data, avatarUrl: Data });

const TeamPresence = Schema.Struct({ userId: Data, status: Data, seenAt: Data });

const TeamTask = Schema.Struct({
  task: SharedTaskRecord,
  gates: Schema.Array(SharedGate),
  project: Schema.NullOr(SharedProject),
  repo: Schema.NullOr(SharedRepo),
  owner: Data,
  ownerProfile: Schema.optionalKey(Schema.NullOr(SharedPerson)),
  machine: Data,
  heldBy: Schema.optionalKey(Schema.NullOr(TeamHolder)),
});

const TeamSnapshot = Schema.Struct({ body: Data, signature: Data });

const TeamListView = Schema.Struct({
  tasks: Schema.Array(TeamTask),
  machineKey: Data,
  grant: Schema.optionalKey(Data),
  updatedAt: Data,
  snapshot: Schema.optionalKey(TeamSnapshot),
  held: Schema.optionalKey(Schema.Array(TeamSnapshot)),
  presence: Schema.optionalKey(Schema.Array(TeamPresence)),
});

export const EgressView = Schema.fromJsonString(Schema.Union([ShareView, TeamListView]));

export const TeamTasks = Schema.Array(TeamTask);

export const PREVIEW_DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'server',
  'server-timing',
  'sourcemap',
  'x-sourcemap',
  'x-powered-by',
  'x-aspnet-version',
  'x-aspnetmvc-version',
  'x-debug-token',
  'x-debug-token-link',
]);
