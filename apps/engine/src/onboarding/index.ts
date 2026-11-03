import { Effect } from 'effect';
import type { ModelSource } from '../agents/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { ConfigStore, ServerConfig } from '../config/index.ts';
import type { JsonObject } from '../http/schema.ts';
import { describeError } from '../log/redact.ts';
import { createProjectChanges } from '../projects/changes.ts';
import type { LoginResolver, Roots } from '../repos/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { runCommand } from '../shell/index.ts';
import { refreshInstallFolders } from '../shell/login.ts';
import type { AccountSource } from './accounts.ts';
import { resolveOnboardingFailure } from './failures.ts';
import { OnboardingSetup } from './flow.ts';
import { INSTALL_SCRIPTS, type InstallTerminals } from './install.ts';
import type { CommandRunner } from './prerequisites.ts';
import { OnboardingCallFailed, type OnboardingHandle } from './schema.ts';
import { makeOnboarding } from './service.ts';
import { createSetupSimulation } from './simulate.ts';

export type { AccountSource, ClaudeAccount } from './accounts.ts';
export { createSummaryAccountSource } from './accounts.ts';
export type { InstallTerminals } from './install.ts';
export type { CommandRunner } from './prerequisites.ts';

export interface OnboardingContext {
  engine: Engine;
  config: ServerConfig;
  store: ConfigStore;
  roots: Roots;
  resolveLogin: LoginResolver;
  ask: QuickJson;
  run?: CommandRunner;
  models: ModelSource;
  accounts: AccountSource;
  terminals?: InstallTerminals;
}

function attempt<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: resolveOnboardingFailure });
}

export class Onboarding {
  readonly setup: OnboardingSetup;
  readonly #handle: OnboardingHandle;

  constructor(context: OnboardingContext) {
    const { engine, config, store, roots, resolveLogin } = context;
    const run = context.run ?? runCommand;
    const simulation =
      config.simulateMissing.length > 0 ? createSetupSimulation(config.simulateMissing, run) : null;
    const runner = simulation?.run ?? run;
    const changes = createProjectChanges({ engine, resolveLogin, userHome: config.userHome });
    this.#handle = edgeRuntime.runSync(
      makeOnboarding({
        paths: {
          home: config.home,
          configPath: config.configPath,
          dataDir: config.dataDir,
          userHome: config.userHome,
        },
        inspect: config.inspect,
        state: Effect.sync(() => engine.state),
        engineReadOnly: Effect.sync(() => engine.readOnly),
        dispatch: (command, options) => attempt(() => engine.dispatch(command, options)),
        machine: Effect.sync(() => store.config),
        updateMachine: (patch) => Effect.sync(() => store.update(patch)),
        roots: {
          configured: Effect.sync(() => roots.configured),
          fromEnvironment: Effect.sync(() => roots.fromEnvironment),
          kind: Effect.sync(() => roots.resolveKind()),
          list: attempt(() => roots.listRoots()),
          discover: (refresh) => attempt(() => roots.discover(refresh)),
        },
        login: attempt(resolveLogin),
        ask: (system, prompt, schema) => attempt(() => context.ask<unknown>(system, prompt, schema)),
        run: (command, cwd, options) =>
          Effect.tryPromise({
            try: () => runner(command, cwd, options),
            catch: (error) => new OnboardingCallFailed({ message: describeError(error) }),
          }),
        scripts: simulation?.scripts ?? INSTALL_SCRIPTS,
        listModels: attempt(() => context.models.listModels()),
        listAccounts: attempt(context.accounts),
        terminals: context.terminals ?? null,
        upsertRepo: (projectId, path, id) =>
          Effect.asVoid(attempt(() => changes.upsertRepo(projectId, path, { id }))),
        refreshInstallFolders: Effect.sync(() => refreshInstallFolders(Bun.env, config.userHome)),
        newId: Effect.sync(() => Bun.randomUUIDv7()),
      })
    );
    this.setup = new OnboardingSetup(this.#handle.setup);
  }

  resolveStatus() {
    return edgeRuntime.runPromise(this.#handle.resolveStatus);
  }

  listSuggestions(refresh: boolean) {
    return edgeRuntime.runPromise(this.#handle.listSuggestions(refresh));
  }

  applySetup(fields: JsonObject, commandId?: string) {
    return edgeRuntime.runPromise(this.#handle.applySetup(fields, commandId));
  }

  complete() {
    return edgeRuntime.runPromise(this.#handle.complete);
  }

  openPrivacySettings() {
    return edgeRuntime.runPromise(this.#handle.openPrivacySettings);
  }

  resolvePrerequisites() {
    return edgeRuntime.runPromise(this.#handle.resolvePrerequisites);
  }

  openInstall(fields: JsonObject) {
    return edgeRuntime.runPromise(this.#handle.openInstall(fields));
  }
}
