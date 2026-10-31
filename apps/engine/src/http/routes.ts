import { basename } from 'node:path';
import {
  type AgentProviderInfo,
  DomainError,
  type EngineRestartWhen,
  KNOWN_AGENT_PROVIDERS,
  LOCAL_ONLY_CODE,
  parseUserCommand,
  type RequestOrigin,
  resolveLocalOnlyRefusal,
  resolveQueueSummary,
  type ShinsaEvent,
  selectTaskByReference,
} from '@shinsa/core';
import type { Accounts } from '../accounts/index.ts';
import { createAccountRoutes } from '../accounts/routes.ts';
import type { ModelSource } from '../agents/index.ts';
import type { Transcripts } from '../agents/transcripts/index.ts';
import type { ServerConfig } from '../config/index.ts';
import type { Extensions } from '../extensions/index.ts';
import { createExtensionRoutes } from '../extensions/routes.ts';
import {
  createReadOnlyError,
  createServerInstance,
  type EngineRestarter,
  resolveEngineActivity,
  resolveHealth,
  type ServerInstance,
} from '../instance/index.ts';
import { describeError } from '../log/index.ts';
import type { Onboarding } from '../onboarding/index.ts';
import { createProjectRoutes } from '../projects/routes.ts';
import { type Remote, resolveRequestOrigin } from '../remote/index.ts';
import { createPlacementRoutes, type PlacementAsker } from '../remote/placement.ts';
import { createRemoteRoutes } from '../remote/routes.ts';
import { createSharePreviewRoutes, type ShareLinks } from '../remote/shares.ts';
import { createLoginResolver, type LoginResolver, type RootSource } from '../repos/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { Schedules } from '../schedules/index.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import {
  ATTACHMENT_REQUEST_LIMIT_BYTES,
  AttachmentStore,
  type EvidenceStore,
  readAttachmentUpload,
} from '../store/index.ts';
import { type Classifier, routeUserCommand } from '../triage/message.ts';
import type { Versions } from '../versions/index.ts';
import { createVersionRoutes } from '../versions/routes.ts';
import type { Workspaces } from '../workspaces/index.ts';
import { type JsonObject, readJson, readJsonObject } from './body.ts';
import { createCodeRoutes } from './code.ts';
import { createEditRoutes } from './edits.ts';
import { resolveAttachmentHeaders, respondEvidenceFile } from './evidence.ts';
import { resolveInside } from './paths.ts';
import { createReadRoutes } from './reads.ts';

export type Launcher = (command: string[], cwd: string) => Promise<CommandResult>;

export interface ApiContext {
  engine: Engine;
  remote?: Remote;
  shares?: ShareLinks;
  config: ServerConfig;
  instance?: ServerInstance;
  evidence: EvidenceStore;
  models: ModelSource;
  providers?: ProviderCatalog;
  onboarding: Onboarding;
  launch?: Launcher;
  accounts?: Accounts;
  schedules?: Schedules;
  transcripts?: Transcripts;
  extensions?: Extensions;
  versions?: Versions;
  roots?: RootSource;
  resolveLogin?: LoginResolver;
  classify?: Classifier;
  place?: PlacementAsker;
  workspaces?: Workspaces;
  restarter?: EngineRestarter;
}

interface ProviderCatalog {
  listProviders: () => Promise<AgentProviderInfo[]>;
}

const KNOWN_PROVIDERS: ProviderCatalog = { listProviders: () => Promise.resolve(KNOWN_AGENT_PROVIDERS) };

export interface ApiRoute {
  method: 'GET' | 'POST';
  pattern: RegExp;
  respond: (match: RegExpExecArray, request: Request) => Promise<Response>;
}

type OpenTarget = 'editor' | 'finder' | 'terminal';

const MAX_IDEMPOTENCY_KEY = 200;

const OPEN_TARGETS = new Set<OpenTarget>(['editor', 'finder', 'terminal']);

function respondJson(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function respondError(code: string, message: string, status: number) {
  return respondJson({ error: { code, message } }, status);
}

export function respondFailure(error: unknown, status = 400) {
  const code = error instanceof DomainError ? error.code : 'request_failed';
  return respondError(code, describeError(error), status);
}

function selectCreatedTaskId(events: ShinsaEvent[]) {
  for (const event of events) if (event.type === 'task.created') return event.taskId;
  return null;
}

export async function dispatchUserCommand(
  engine: Engine,
  body: unknown,
  clientId: string | null = null,
  classify: Classifier | null = null,
  origin: RequestOrigin = 'local'
) {
  if (engine.readOnly) throw createReadOnlyError();
  const command = parseUserCommand(body);
  const refusal = resolveLocalOnlyRefusal(origin, command);
  if (refusal) throw new DomainError(LOCAL_ONLY_CODE, refusal);
  return selectCreatedTaskId(
    await routeUserCommand(engine, command, clientId ? `client:${clientId}` : null, classify)
  );
}

function readIdempotencyKey(request: Request) {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length > MAX_IDEMPOTENCY_KEY)
    throw new DomainError('idempotency_key_invalid', 'The Idempotency-Key header is too long.');
  return key || null;
}

function readOpenRequest(body: JsonObject) {
  const { target, path, line } = body;
  if (!OPEN_TARGETS.has(target as OpenTarget))
    throw new DomainError('target_invalid', 'Open it in the editor, Finder or Terminal.');
  return {
    target: target as OpenTarget,
    path: typeof path === 'string' && path ? path : null,
    line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : null,
  };
}

function createTaskRoutes(context: ApiContext): ApiRoute[] {
  const { engine, config } = context;
  const launch = context.launch ?? runCommand;

  function selectWorktreeTask(reference: string) {
    const task = selectTaskByReference(engine.state, reference);
    const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
    if (!task?.worktreePath || !repo) return null;
    return { task, repo, worktreePath: task.worktreePath };
  }

  function resolveOpenCommand(target: OpenTarget, worktreePath: string, location: string | null) {
    const editor = config.editor ?? (Bun.which('cursor') ? 'cursor' : 'code');
    if (target === 'editor')
      return location ? [editor, worktreePath, '--goto', location] : [editor, worktreePath];
    if (target === 'terminal') return ['open', '-a', config.terminal, worktreePath];
    return ['open', worktreePath];
  }

  async function respondOpen(taskId: string, request: Request) {
    const found = selectWorktreeTask(taskId);
    if (!found) return respondError('worktree_missing', 'No worktree.', 404);
    const { target, path, line } = readOpenRequest(await readJsonObject(request));
    const file = path ? resolveInside(found.worktreePath, path) : null;
    const location = file && line ? `${file}:${line}` : file;
    const result = await launch(resolveOpenCommand(target, found.worktreePath, location), found.worktreePath);
    return respondJson({ ok: result.ok });
  }

  return [
    ...createCodeRoutes(engine),
    ...(context.workspaces ? createEditRoutes(engine, context.workspaces) : []),
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/([^/]+)\/open$/,
      respond: ([, id = ''], request) => respondOpen(decodeURIComponent(id), request),
    },
  ];
}

function readRestartWhen(body: JsonObject): EngineRestartWhen {
  if (body.when === 'now' || body.when === 'idle') return body.when;
  throw new DomainError('when_invalid', 'Restart the engine now or once agents are idle.');
}

function createServerRoutes(context: ApiContext): ApiRoute[] {
  const { engine, config, evidence, models, providers, classify, restarter } = context;
  const instance = context.instance ?? createServerInstance();
  const attachments = new AttachmentStore(config.attachmentsDir);
  async function respondCommand(request: Request) {
    const key = readIdempotencyKey(request);
    const taskId = await dispatchUserCommand(
      engine,
      await readJson(request),
      key,
      classify ?? null,
      resolveRequestOrigin(request)
    );
    const handle = taskId ? (engine.state.tasks[taskId]?.handle ?? null) : null;
    return respondJson({ ok: true, taskId, handle });
  }

  async function respondAttachmentUpload(request: Request) {
    const body = await readJsonObject(request, ATTACHMENT_REQUEST_LIMIT_BYTES);
    return respondJson(attachments.write(readAttachmentUpload(body)));
  }

  function respondAttachment(name: string, request: Request) {
    const path = attachments.selectFile(name);
    if (!path) return Promise.resolve(new Response('Not found', { status: 404 }));
    const file = Bun.file(path);
    const headers = resolveAttachmentHeaders(file.type, basename(path));
    return Promise.resolve(respondEvidenceFile(file, request.headers.get('range'), headers));
  }

  function respondEvidence(name: string, request: Request) {
    const path = evidence.selectFile(name);
    if (!path) return Promise.resolve(new Response('Not found', { status: 404 }));
    return Promise.resolve(respondEvidenceFile(Bun.file(path), request.headers.get('range')));
  }

  return [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      respond: () =>
        Promise.resolve(
          respondJson(
            resolveHealth(
              { seq: engine.state.seq, problems: engine.problems },
              config.dataDir,
              instance,
              resolveEngineActivity(engine.state, restarter)
            )
          )
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/engine\/restart$/,
      respond: async (_match, request) => {
        const when = readRestartWhen(await readJsonObject(request));
        if (!restarter) {
          throw new DomainError('restart_unsupported', 'This Shinsa cannot restart its engine from the app.');
        }
        return respondJson(await restarter.request(when));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/models$/,
      respond: async () => respondJson(await models.listModels()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/providers$/,
      respond: async () => respondJson(await (providers ?? KNOWN_PROVIDERS).listProviders()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/commands$/,
      respond: (_match, request) => respondCommand(request),
    },
    {
      method: 'GET',
      pattern: /^\/api\/queue$/,
      respond: (_match, request) =>
        Promise.resolve(
          respondJson(resolveQueueSummary(engine.state, Date.now(), new URL(request.url).origin))
        ),
    },
    {
      method: 'GET',
      pattern: /^\/api\/evidence\/(.+)$/,
      respond: ([, name = ''], request) => respondEvidence(name, request),
    },
    {
      method: 'POST',
      pattern: /^\/api\/attachments$/,
      respond: (_match, request) => respondAttachmentUpload(request),
    },
    {
      method: 'GET',
      pattern: /^\/api\/attachments\/(.+)$/,
      respond: ([, name = ''], request) => respondAttachment(name, request),
    },
  ];
}

function createOnboardingRoutes(onboarding: Onboarding): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/onboarding$/,
      respond: async () => respondJson(await onboarding.resolveStatus()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/onboarding\/roots$/,
      respond: async (_match, request) =>
        respondJson(
          await onboarding.listSuggestions(new URL(request.url).searchParams.get('refresh') === '1')
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/onboarding\/setup$/,
      respond: async (_match, request) =>
        respondJson(await onboarding.applySetup(await readJsonObject(request))),
    },
    {
      method: 'GET',
      pattern: /^\/api\/onboarding\/prerequisites$/,
      respond: async () => respondJson(await onboarding.resolvePrerequisites()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/onboarding\/privacy$/,
      respond: async () => respondJson(await onboarding.openPrivacySettings()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/onboarding\/complete$/,
      respond: async () => respondJson(await onboarding.complete()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/onboarding\/flow$/,
      respond: async () => respondJson(await onboarding.setup.resolve()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/onboarding\/flow$/,
      respond: async (_match, request) =>
        respondJson(await onboarding.setup.reply(await readJsonObject(request))),
    },
  ];
}

export function createApiRoutes(context: ApiContext, extra: ApiRoute[] = []) {
  const routes: ApiRoute[] = [
    ...extra,
    ...createTaskRoutes(context),
    ...createServerRoutes(context),
    ...createOnboardingRoutes(context.onboarding),
    ...(context.accounts ? createAccountRoutes(context.accounts) : []),
    ...(context.schedules ? context.schedules.routes() : []),
    ...(context.transcripts ? createReadRoutes(context.engine, context.transcripts) : []),
    ...(context.extensions ? createExtensionRoutes(context.extensions) : []),
    ...(context.versions ? createVersionRoutes(context.versions) : []),
    ...(context.remote ? createRemoteRoutes(context.remote) : []),
    ...(context.shares ? createSharePreviewRoutes(context.shares) : []),
    ...(context.place ? createPlacementRoutes(context.place) : []),
    ...(context.roots
      ? createProjectRoutes({
          engine: context.engine,
          roots: context.roots,
          resolveLogin: context.resolveLogin ?? createLoginResolver(context.config.userHome),
          userHome: context.config.userHome,
        })
      : []),
  ];

  return function handleApi(request: Request, url: URL): Promise<Response> {
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match || route.method !== request.method) continue;
      return route.respond(match, request);
    }
    return Promise.resolve(respondError('not_found', 'No such endpoint.', 404));
  };
}
