import { BunServices } from '@effect/platform-bun';
import { DomainError, type ProviderLogin, type ShinsaCommand, type ShinsaEvent } from '@shinsa/core';
import { Context, Duration, Effect, Exit, Layer, Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { KeychainPlatform } from '../../src/accounts/keychain/schema.ts';
import { AccountsLayer } from '../../src/accounts/layers.ts';
import { type LoginTimers, LoginTimerSettings } from '../../src/accounts/login/schema.ts';
import type { Env } from '../../src/accounts/paths.ts';
import { UsageResumeTimingSettings } from '../../src/accounts/resume/schema.ts';
import {
  AccountsEnv,
  AccountsInput,
  AccountsRefreshInterval,
  AccountStepFailed,
  ClaudeCommandPath,
  KEYCHAIN_COMMAND,
  KEYCHAIN_NOT_FOUND,
  NewAccountId,
  UsageTtl,
} from '../../src/accounts/schema.ts';
import type { ProviderUsageReading } from '../../src/agents/providers/types.ts';
import { ProgramVersions } from '../../src/agents/providers/versions/service.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonFile } from '../../src/files/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { TerminalPty } from '../../src/terminals/pty/service.ts';
import { createTempDir, createTestConfig } from '../helpers/index.ts';
import { createStubEngine, type StubEngine } from '../helpers/state.ts';

export interface FakeCommandOptions {
  env?: Record<string, string | undefined>;
  timeoutMs?: number | null;
}

export type FakeRunner = (
  command: string[],
  cwd: string,
  options: FakeCommandOptions
) => Promise<CommandResult>;

export type FakeSecretReader = (service: string, account: string) => Promise<string | null | CommandResult>;

export interface ShellCall {
  command: string[];
  cwd: string;
  timeoutMs: number | null;
}

export interface FakeLoginProcess {
  write: (data: string) => void;
  kill: () => void;
  exited: Promise<number>;
}

export interface FakeLoginOptions {
  cwd: string;
  env: Env;
  onData: (text: string) => void;
}

export type FakeLoginSpawner = (command: string[], options: FakeLoginOptions) => FakeLoginProcess;

export interface AccountsHarnessOptions {
  config: ServerConfig;
  engine: EngineCore['Service'];
  env?: Env;
  run?: FakeRunner;
  readSecret?: FakeSecretReader;
  requestHttp?: (url: string, init: RequestInit) => Promise<Response>;
  spawnLogin?: FakeLoginSpawner;
  resolveClaude?: (() => Promise<string>) | 'installed';
  providerUsage?: { id: string; read: Effect.Effect<ProviderUsageReading, { readonly message: string }> }[];
  providerLogins?: () => Promise<ProviderLogin[]>;
  forward?: (runId: string, notice: Parameters<AccountsInputForward>[1]) => void;
  refreshIntervalMs?: number;
  loginTimers?: Partial<LoginTimers>;
  usageTtlMs?: number;
  newId?: () => string;
  resume?: { graceMs?: number; retryMs?: number };
  now?: number;
  platform?: string;
  liveClock?: boolean;
  realTerminals?: boolean;
  realShell?: boolean;
}

type AccountsInputForward = Context.Service.Shape<typeof AccountsInput>['forward'];

function result(ok: boolean, code: number, stdout = ''): CommandResult {
  return { ok, code, stdout, stderr: '', timedOut: false };
}

function describeRejection(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createStubEngineCore(stub: StubEngine): EngineCore['Service'] {
  const engine = stub.engine as unknown as {
    dispatch: (command: ShinsaCommand, options: { id?: string }) => Promise<ShinsaEvent[]>;
    subscribe: (listener: () => void) => () => void;
  };
  return {
    readOnly: false,
    problems: [],
    state: Effect.sync(() => stub.state),
    updates: Effect.die('not used') as never,
    observe: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => engine.subscribe(() => listener(stub.state, {} as never))),
        (release) => Effect.sync(release)
      ).pipe(Effect.asVoid),
    dispatch: (command, options) =>
      Effect.tryPromise({
        try: () => engine.dispatch(command, options ?? {}),
        catch: (error) =>
          error instanceof DomainError
            ? error
            : new DomainError({ code: 'rejected', message: describeRejection(error) }),
      }),
    writeBriefing: () => Effect.void,
    hasReceipt: () => Effect.succeed(false),
    writeSnapshot: Effect.succeed(false),
    replaceHandlers: () => Effect.void,
    start: Effect.void,
    stop: Effect.void,
    settle: Effect.void,
  };
}

function createFakeShell(run: FakeRunner, readSecret: FakeSecretReader, calls: ShellCall[] = []) {
  return Shell.of({
    run: (request) =>
      Effect.promise(async () => {
        const [program, ...args] = request.argv;
        const timeoutMs = request.timeout === null ? null : Duration.toMillis(request.timeout);
        calls.push({ command: [...request.argv], cwd: request.cwd, timeoutMs });
        if (program === KEYCHAIN_COMMAND) {
          const secret = await readSecret(
            args[args.indexOf('-s') + 1] ?? '',
            args[args.indexOf('-a') + 1] ?? ''
          ).catch((error: unknown) => ({ ...result(false, 1), stderr: describeRejection(error) }));
          if (secret === null) return result(false, KEYCHAIN_NOT_FOUND);
          return typeof secret === 'string' ? result(true, 0, secret) : secret;
        }
        return run([...request.argv], request.cwd, { env: request.env, timeoutMs });
      }),
    stopTree: () => Effect.void,
  });
}

function createFakePty(spawnLogin: FakeLoginSpawner) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return TerminalPty.of({
    spawn: (command, options) =>
      Effect.sync(() => {
        const child = spawnLogin([...command], {
          cwd: options.cwd,
          env: options.env,
          onData: (text) => options.onData(encoder.encode(text)),
        });
        return {
          pid: 1,
          write: (data) => child.write(typeof data === 'string' ? data : decoder.decode(data)),
          resize: () => undefined,
          hangUp: () => child.kill(),
          exited: child.exited,
        };
      }),
    readForeground: () => Effect.succeed(null),
    pickPort: () => Effect.die('not used'),
  });
}

const NOT_INSTALLED: FakeRunner = () => Promise.resolve(result(false, 127));

const NO_SECRET: FakeSecretReader = () => Promise.resolve(null);

const NO_LOGIN: FakeLoginSpawner = () => ({
  write: () => undefined,
  kill: () => undefined,
  exited: Promise.resolve(0),
});

function createAccountsLayer(options: AccountsHarnessOptions, calls: ShellCall[] = []) {
  const failed = (error: unknown) => new AccountStepFailed({ message: describeRejection(error) });
  const { resolveClaude, providerLogins, requestHttp, forward } = options;
  const references = Layer.mergeAll(
    Layer.empty,
    ...(options.env ? [Layer.succeed(AccountsEnv, options.env)] : []),
    ...(options.platform === 'host' ? [] : [Layer.succeed(KeychainPlatform, options.platform ?? 'darwin')]),
    ...(options.providerUsage || providerLogins || forward
      ? [
          Layer.succeed(AccountsInput, {
            usageSources: (options.providerUsage ?? []).map((source) => ({
              id: source.id,
              read: source.read.pipe(
                Effect.mapError((failure) => new AccountStepFailed({ message: failure.message }))
              ),
            })),
            listProviderLogins: providerLogins
              ? Effect.tryPromise({ try: () => providerLogins(), catch: failed })
              : Effect.succeed([]),
            forward: (runId, notice) => Effect.sync(() => forward?.(runId, notice)),
          }),
        ]
      : []),
    ...(resolveClaude === 'installed'
      ? []
      : [
          Layer.succeed(
            ClaudeCommandPath,
            resolveClaude
              ? Effect.tryPromise({ try: () => resolveClaude(), catch: failed })
              : Effect.succeed('claude')
          ),
        ]),
    ...(options.refreshIntervalMs === undefined
      ? []
      : [Layer.succeed(AccountsRefreshInterval, Duration.millis(options.refreshIntervalMs))]),
    ...(options.loginTimers
      ? [
          Layer.succeed(LoginTimerSettings, {
            menuFallbackMs: 60_000,
            urlTimeoutMs: 60_000,
            watchdogMs: 60_000,
            ...options.loginTimers,
          }),
        ]
      : []),
    ...(options.resume
      ? [
          Layer.succeed(UsageResumeTimingSettings, {
            grace: Duration.millis(options.resume.graceMs ?? 0),
            retry: Duration.millis(options.resume.retryMs ?? 60_000),
          }),
        ]
      : []),
    ...(options.usageTtlMs === undefined
      ? []
      : [Layer.succeed(UsageTtl, Duration.millis(options.usageTtlMs))]),
    ...(options.newId ? [Layer.succeed(NewAccountId, Effect.sync(options.newId))] : []),
    ...(requestHttp
      ? [
          Layer.succeed(
            FetchHttpClient.Fetch,
            Object.assign(
              (url: string | URL | Request, init?: RequestInit) => requestHttp(String(url), init ?? {}),
              { preconnect: fetch.preconnect }
            )
          ),
        ]
      : [])
  );
  const shell = createFakeShell(options.run ?? NOT_INSTALLED, options.readSecret ?? NO_SECRET, calls);
  return AccountsLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        options.realShell ? ShellLayer : Layer.succeed(Shell, shell),
        options.realTerminals
          ? TerminalPty.layer.pipe(Layer.provide(ShellLayer))
          : Layer.succeed(TerminalPty, createFakePty(options.spawnLogin ?? NO_LOGIN)),
        Layer.succeed(EngineConfig, options.config),
        Layer.succeed(EngineCore, options.engine),
        ProgramVersions.layer.pipe(Layer.provide(ShellLayer)),
        JsonFile.layer.pipe(Layer.provide(BunServices.layer))
      )
    ),
    Layer.provideMerge(references),
    Layer.provideMerge(JsonLogger),
    Layer.provideMerge(options.liveClock ? Layer.empty : TestClock.layer())
  );
}

export type AccountsContext = Layer.Success<ReturnType<typeof createAccountsLayer>>;

export async function buildAccounts(options: AccountsHarnessOptions) {
  const scope = Effect.runSync(Scope.make());
  const calls: ShellCall[] = [];
  const context = await Effect.runPromise(Layer.buildWithScope(createAccountsLayer(options, calls), scope));
  const harness = openContext(context, scope, calls);
  if (options.now !== undefined) await harness.setTime(options.now);
  return harness;
}

export function buildAccountsNow(options: AccountsHarnessOptions) {
  const scope = Effect.runSync(Scope.make());
  const calls: ShellCall[] = [];
  const context = Effect.runSync(Layer.buildWithScope(createAccountsLayer(options, calls), scope));
  return openContext(context, scope, calls);
}

function openContext(context: Context.Context<AccountsContext>, scope: Scope.Closeable, calls: ShellCall[]) {
  const run = <A, E>(effect: Effect.Effect<A, E, AccountsContext>) => Effect.runPromiseWith(context)(effect);
  const runSync = <A, E>(effect: Effect.Effect<A, E, AccountsContext>) => Effect.runSyncWith(context)(effect);
  return {
    context,
    calls,
    run,
    runSync,
    service: <I, S>(tag: Context.Key<I, S>) => Context.get(context as Context.Context<I>, tag),
    setTime: (now: number) => run(TestClock.setTime(now)),
    adjust: (ms: number) => run(TestClock.adjust(Duration.millis(ms))),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

export type AccountsHarness = ReturnType<typeof openContext>;

export function buildUnitAccounts(options: Partial<AccountsHarnessOptions> = {}) {
  return buildAccounts({
    config: createTestConfig(createTempDir()),
    engine: createStubEngineCore(createStubEngine()),
    ...options,
  });
}
