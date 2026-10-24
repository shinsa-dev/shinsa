import { join } from 'node:path';
import {
  DomainError,
  MERGE_METHODS,
  type OnboardingStatus,
  type RootSuggestions,
  type Settings,
} from '@shinsa/core';
import type { ModelSource } from '../agents/index.ts';
import type { ConfigStore, ServerConfig } from '../config/index.ts';
import type { JsonObject } from '../http/body.ts';
import type { Roots } from '../repos/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { AccountActions, AccountSource } from './accounts.ts';
import { type Interpreter, OnboardingConversation } from './chat.ts';
import { type CommandRunner, resolvePrerequisites } from './prerequisites.ts';
import { ONBOARDING_QUESTIONS, type SetupPatch } from './questions.ts';
import { resolveChosenRoots } from './roots.ts';

export type { AccountActions, AccountSource, ClaudeAccount } from './accounts.ts';
export { createSummaryAccountSource } from './accounts.ts';
export type { Interpreter } from './chat.ts';
export type { CommandRunner } from './prerequisites.ts';

export interface OnboardingContext {
  engine: Engine;
  config: ServerConfig;
  store: ConfigStore;
  roots: Roots;
  run?: CommandRunner;
  models: ModelSource;
  accounts: AccountSource;
  accountActions: AccountActions;
  interpret: Interpreter;
  clarify: Interpreter;
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
  readonly chat: OnboardingConversation;

  constructor(context: OnboardingContext) {
    this.#context = context;
    this.chat = new OnboardingConversation({
      path: join(context.config.dataDir, 'onboarding.json'),
      questions: ONBOARDING_QUESTIONS,
      interpret: context.interpret,
      clarify: context.clarify,
      isCompleted: () => context.store.config.onboardedAt !== null,
      complete: async () => {
        await this.complete();
      },
      resolveContext: () =>
        Promise.resolve({
          userHome: context.config.userHome,
          settings: context.engine.state.settings,
          roots: context.roots.configured,
          suggestRoots: () => this.listSuggestions(false),
          listModels: () => context.models.listModels(),
          listAccounts: context.accounts,
          accountActions: context.accountActions,
          inspect: context.config.inspect,
          checkPrerequisites: () => this.resolvePrerequisites(),
          save: (patch, commandId) => this.#saveAnswer(patch, commandId),
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

  resolvePrerequisites() {
    return resolvePrerequisites(this.#context.config.userHome, this.#context.run);
  }

  async #saveAnswer(patch: SetupPatch, commandId: string | undefined) {
    await this.applySetup({ ...patch, roots: patch.roots ?? this.#context.store.config.roots }, commandId);
  }
}
