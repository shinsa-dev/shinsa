import { join } from 'node:path';
import {
  DomainError,
  MERGE_METHODS,
  type OnboardingCheck,
  type OnboardingStatus,
  PLAN_APPROVALS,
  type PlanApproval,
  type RootSuggestions,
  type Settings,
  selectWelcomeTask,
} from '@shinsa/core';
import type { ModelSource } from '../agents/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { ConfigStore, ServerConfig } from '../config/index.ts';
import type { JsonObject } from '../http/body.ts';
import { createProjectChanges } from '../projects/routes.ts';
import type { LoginResolver, Roots } from '../repos/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { runCommand } from '../shell/index.ts';
import { refreshInstallFolders } from '../shell/login.ts';
import type { AccountSource } from './accounts.ts';
import { type FlowContext, OnboardingSetup } from './flow.ts';
import {
  INSTALL_SCRIPTS,
  type InstallScripts,
  type InstallTerminals,
  openInstallAllTerminal,
  openInstallTerminal,
  openReplyTerminal,
} from './install.ts';
import { type CommandRunner, isBunUsed, resolvePrerequisites } from './prerequisites.ts';
import {
  createChosenProjects,
  listFiledProjects,
  listProjectSuggestions,
  type ProjectSetup,
} from './projects.ts';
import type { ProjectRevision } from './revise.ts';
import { requestRevision } from './revise.ts';
import { PRIVACY_SETTINGS_URL, resolveChosenRoots } from './roots.ts';
import { createSetupSimulation } from './simulate.ts';
import { ONBOARDING_STEPS, type SetupPatch } from './steps.ts';
import { resolveHelpRequest, resolveWelcomeBody } from './welcome.ts';

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
    if (!PLAN_APPROVALS.has(fields.approvePlans as PlanApproval)) {
      throw new DomainError('plans_invalid', 'Approve plans when you ask, for large plans or always.');
    }
    patch.approvePlans = fields.approvePlans as PlanApproval;
  }
  return patch;
}

export class Onboarding {
  readonly #context: OnboardingContext;
  readonly setup: OnboardingSetup;
  readonly #projects: ProjectSetup;
  readonly #run: CommandRunner;
  readonly #scripts: InstallScripts;

  constructor(context: OnboardingContext) {
    this.#context = context;
    const run = context.run ?? runCommand;
    const simulation =
      context.config.simulateMissing.length > 0
        ? createSetupSimulation(context.config.simulateMissing, run)
        : null;
    this.#run = simulation?.run ?? run;
    this.#scripts = simulation?.scripts ?? INSTALL_SCRIPTS;
    const { engine, resolveLogin } = context;
    this.#projects = {
      engine,
      resolveLogin,
      changes: createProjectChanges({ engine, resolveLogin, userHome: context.config.userHome }),
    };
    this.setup = new OnboardingSetup({
      path: join(context.config.dataDir, 'onboarding.json'),
      steps: ONBOARDING_STEPS,
      isCompleted: () => context.store.config.onboardedAt !== null,
      readOnly: context.config.inspect,
      complete: async () => {
        await this.complete();
      },
      requestHelp: (checks) => this.#requestHelp(checks),
      selectWelcome: () => selectWelcomeTask(context.engine.state.tasks)?.id ?? null,
      reviseProjects: async (revision, text, choices) => {
        const suggestions = await listProjectSuggestions(this.#projects, context.roots.configured, revision);
        return requestRevision(context.ask, suggestions, revision, text, choices);
      },
      resolveContext: (revision) => this.#resolveContext(revision),
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

  async complete() {
    const { store } = this.#context;
    if (store.config.roots.length === 0) {
      throw new DomainError('roots_required', 'Choose the folders that hold your repositories first.');
    }
    if (store.config.onboardedAt === null) store.update({ onboardedAt: Date.now() });
    await this.#recordWelcome();
    return this.resolveStatus();
  }

  async #recordWelcome() {
    const { engine } = this.#context;
    if (engine.readOnly || selectWelcomeTask(engine.state.tasks)) return;
    const context = this.#resolveContext(null);
    const steps = ONBOARDING_STEPS.filter((step) => step.id !== 'prerequisites');
    const lines = await Promise.all(
      steps.map(async (step) => ({ label: step.label, summary: await step.summarize(context) }))
    );
    await engine.dispatch({ type: 'onboarding.welcome', body: resolveWelcomeBody(lines) });
  }

  async #requestHelp(checks: OnboardingCheck[]) {
    const events = await this.#context.engine.dispatch({
      type: 'task.create',
      request: resolveHelpRequest(checks),
      repoId: null,
      projectId: null,
      mode: 'ask',
    });
    const created = events.find((event) => event.type === 'task.created');
    return created?.taskId ?? null;
  }

  async openPrivacySettings() {
    const result = await this.#run(['open', PRIVACY_SETTINGS_URL], this.#context.config.userHome);
    return { ok: result.ok };
  }

  async resolvePrerequisites() {
    const { config, roots } = this.#context;
    refreshInstallFolders(Bun.env, config.userHome);
    return resolvePrerequisites(config.userHome, this.#run, { bun: isBunUsed(await roots.listRoots()) });
  }

  async openInstall(fields: JsonObject) {
    const { terminals, config, engine } = this.#context;
    if (typeof fields.id !== 'string' && typeof fields.command !== 'string' && fields.all !== true)
      throw new DomainError(
        'body_invalid',
        'Send “id” as the check to fix, such as gh, “all” for every missing tool, or a “command” from the help task.'
      );
    if (!terminals) throw new DomainError('terminals_off', 'Terminals are off, so run the command yourself.');
    if (typeof fields.id === 'string')
      return { terminal: openInstallTerminal(terminals, fields.id, config.userHome, this.#scripts) };
    if (fields.all === true) {
      const report = await this.resolvePrerequisites();
      return { terminal: openInstallAllTerminal(terminals, report.checks, config.userHome, this.#scripts) };
    }
    const helpId = await this.setup.selectHelp();
    const body = (helpId && engine.state.tasks[helpId]?.result?.body) || null;
    return {
      terminal: openReplyTerminal(terminals, body, String(fields.command), config.userHome, this.#scripts),
    };
  }

  #resolveContext(revision: ProjectRevision | null): FlowContext {
    const context = this.#context;
    return {
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
    };
  }

  async #saveAnswer(patch: SetupPatch, commandId: string) {
    await this.applySetup({ ...patch, roots: patch.roots ?? this.#context.store.config.roots }, commandId);
  }
}
