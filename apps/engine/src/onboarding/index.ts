import { join } from 'node:path';
import {
  DomainError,
  MERGE_METHODS,
  type OnboardingStatus,
  type RootSuggestions,
  type Settings,
} from '@shinsa/core';
import type { ModelSource } from '../agents/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { ConfigStore, ServerConfig } from '../config/index.ts';
import type { JsonObject } from '../http/body.ts';
import { createProjectChanges } from '../projects/routes.ts';
import type { LoginResolver, Roots } from '../repos/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { runCommand } from '../shell/index.ts';
import type { AccountActions, AccountSource } from './accounts.ts';
import { OnboardingSetup } from './flow.ts';
import { type CommandRunner, resolvePrerequisites } from './prerequisites.ts';
import {
  createChosenProjects,
  listFiledProjects,
  listProjectSuggestions,
  type ProjectSetup,
} from './projects.ts';
import { requestRevision } from './revise.ts';
import { PRIVACY_SETTINGS_URL, resolveChosenRoots } from './roots.ts';
import { ONBOARDING_STEPS, type SetupPatch } from './steps.ts';

export type { AccountActions, AccountSource, ClaudeAccount } from './accounts.ts';
export { createSummaryAccountSource } from './accounts.ts';
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
  accountActions: AccountActions;
}

const MODEL_ID = /^[\w.[\]-]{1,100}$/;

function resolveDefaults(fields: JsonObject): Partial<Settings> {
  const patch: Partial<Settings> = {};
  if (fields.defaultModel !== undefined) {
    const model = fields.defaultModel;
    if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model))) {
      throw new DomainError('model_invalid', 'Pick a model from the list.');
    }
    patch.defaultModel = model;
  }
  if (fields.mergeMethod !== undefined) {
    if (!MERGE_METHODS.has(fields.mergeMethod as Settings['mergeMethod'])) {
      throw new DomainError('merge_method_invalid', 'Merge with squash, merge or rebase.');
    }
    patch.mergeMethod = fields.mergeMethod as Settings['mergeMethod'];
  }
  if (fields.approvePlans !== undefined) {
    if (typeof fields.approvePlans !== 'boolean') {
      throw new DomainError('plans_invalid', 'Say yes or no to approving plans.');
    }
    patch.approvePlans = fields.approvePlans;
  }
  return patch;
}

export class Onboarding {
  readonly #context: OnboardingContext;
  readonly setup: OnboardingSetup;
  readonly #projects: ProjectSetup;

  constructor(context: OnboardingContext) {
    this.#context = context;
    const { engine, resolveLogin } = context;
    this.#projects = {
      engine,
      resolveLogin,
      changes: createProjectChanges({ engine, resolveLogin, userHome: context.config.userHome }),
    };
    this.setup = new OnboardingSetup({
      path: join(context.config.dataDir, 'onboarding.json'),
      steps: ONBOARDING_STEPS,
      accountActions: context.accountActions,
      isCompleted: () => context.store.config.onboardedAt !== null,
      readOnly: context.config.inspect,
      complete: async () => {
        await this.complete();
      },
      reviseProjects: async (revision, text, choices) => {
        const suggestions = await listProjectSuggestions(this.#projects, context.roots.configured, revision);
        return requestRevision(context.ask, suggestions, revision, text, choices);
      },
      resolveContext: (revision) => ({
        userHome: context.config.userHome,
        settings: context.engine.state.settings,
        roots: context.roots.configured,
        projectCount: Object.keys(context.engine.state.projects).length,
        suggestRoots: () => this.listSuggestions(false),
        suggestProjects: () => listProjectSuggestions(this.#projects, context.roots.configured, revision),
        listFiledProjects: () => listFiledProjects(context.engine, context.roots.configured),
        listModels: () => context.models.listModels(),
        listAccounts: context.accounts,
        checkPrerequisites: () => this.resolvePrerequisites(),
        save: (patch, commandId) => this.#saveAnswer(patch, commandId),
        createProjects: (choices, commandId) =>
          createChosenProjects(this.#projects, context.roots.configured, choices, commandId, revision),
      }),
    });
  }

  async resolveStatus(): Promise<OnboardingStatus> {
    const { engine, config, store, roots } = this.#context;
    const completedAt = store.config.onboardedAt;
    return {
      completed: completedAt !== null,
      completedAt,
      roots: {
        source: roots.resolveKind(),
        configured: roots.configured,
        fromEnvironment: roots.fromEnvironment,
        effective: await roots.listRoots(),
      },
      defaults: {
        model: engine.state.settings.defaultModel,
        mergeMethod: engine.state.settings.mergeMethod,
      },
      paths: {
        home: config.home,
        configPath: config.configPath,
        dataDir: config.dataDir,
        userHome: config.userHome,
      },
    };
  }

  async listSuggestions(refresh: boolean): Promise<RootSuggestions> {
    const { candidates, truncated } = await this.#context.roots.discover(refresh);
    const chosen = new Set(this.#context.roots.configured);
    const suggestions = candidates.map((candidate) => ({
      ...candidate,
      chosen: chosen.has(candidate.path),
    }));
    return { suggestions, truncated };
  }

  async applySetup(fields: JsonObject, commandId?: string) {
    const roots = resolveChosenRoots(fields.roots, this.#context.config.userHome);
    const defaults = resolveDefaults(fields);
    if (Object.keys(defaults).length > 0) {
      await this.#context.engine.dispatch(
        { type: 'settings.change', patch: defaults },
        commandId ? { id: commandId } : {}
      );
    }
    this.#context.store.update({ roots });
    return this.resolveStatus();
  }

  complete() {
    const { store } = this.#context;
    if (store.config.roots.length === 0) {
      throw new DomainError('roots_required', 'Choose the folders that hold your repositories first.');
    }
    if (store.config.onboardedAt === null) store.update({ onboardedAt: Date.now() });
    return this.resolveStatus();
  }

  async openPrivacySettings() {
    const run = this.#context.run ?? runCommand;
    const result = await run(['open', PRIVACY_SETTINGS_URL], this.#context.config.userHome);
    return { ok: result.ok };
  }

  resolvePrerequisites() {
    return resolvePrerequisites(this.#context.config.userHome, this.#context.run);
  }

  async #saveAnswer(patch: SetupPatch, commandId: string) {
    await this.applySetup({ ...patch, roots: patch.roots ?? this.#context.store.config.roots }, commandId);
  }
}
