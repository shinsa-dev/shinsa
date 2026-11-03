import { join } from 'node:path';
import {
  DomainError,
  MERGE_METHODS,
  type OnboardingCheck,
  type OnboardingProjectChoice,
  type OnboardingStatus,
  PLAN_APPROVALS,
  type PlanApproval,
  type RootSuggestions,
  type Settings,
  selectWelcomeTask,
  type TerminalInfo,
} from '@shinsa/core';
import { Clock, Effect } from 'effect';
import type { JsonObject } from '../http/schema.ts';
import { RepoFolders } from '../repos/folders/service.ts';
import { resolveOnboardingFailure } from './failures.ts';
import type { FlowContext } from './flow/schema.ts';
import { makeOnboardingSetup } from './flow/service.ts';
import { openInstallAllTerminal, openInstallTerminal, openReplyTerminal } from './install.ts';
import { isBunUsed } from './prerequisites/catalog.ts';
import { resolvePrerequisiteReport } from './prerequisites/service.ts';
import { createChosenProjects, listFiledProjects, listProjectSuggestions } from './projects.ts';
import type { ProjectSetup } from './projects/schema.ts';
import { requestRevision } from './revise.ts';
import { PRIVACY_SETTINGS_URL, resolveChosenRoots } from './roots.ts';
import {
  MODEL_ID,
  type OnboardingDefinition,
  type OnboardingHandle,
  PREREQUISITE_TIMEOUT_MS,
  type ProjectRevision,
} from './schema.ts';
import { ONBOARDING_STEPS } from './steps.ts';
import type { SetupPatch } from './steps/schema.ts';
import { resolveHelpRequest, resolveWelcomeBody } from './welcome.ts';

export const makeOnboarding = Effect.fn('Onboarding.make')(function* (definition: OnboardingDefinition) {
  const folders = yield* RepoFolders;
  const { paths, roots, terminals } = definition;
  const { userHome } = paths;

  const projects: ProjectSetup = {
    state: definition.state,
    login: definition.login,
    dispatch: (command, id) => Effect.asVoid(definition.dispatch(command, { id })),
    upsertRepo: definition.upsertRepo,
    listLocal: (list, limit) => folders.listLocal(list, limit),
    readOrigin: (repo) => folders.readOrigin(repo),
  };

  const resolveDefaults = Effect.fn('Onboarding.resolveDefaults')(function* (fields: JsonObject) {
    const patch: Partial<Settings> = {};
    if (fields.defaultModel !== undefined) {
      const model = fields.defaultModel;
      if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model))) {
        return yield* new DomainError({ code: 'model_invalid', message: 'Pick a model from the list.' });
      }
      patch.defaultModel = model;
    }
    if (fields.mergeMethod !== undefined) {
      if (!MERGE_METHODS.has(fields.mergeMethod as Settings['mergeMethod'])) {
        return yield* new DomainError({
          code: 'merge_method_invalid',
          message: 'Merge with squash, merge or rebase.',
        });
      }
      patch.mergeMethod = fields.mergeMethod as Settings['mergeMethod'];
    }
    if (fields.approvePlans !== undefined) {
      if (!PLAN_APPROVALS.has(fields.approvePlans as PlanApproval)) {
        return yield* new DomainError({
          code: 'plans_invalid',
          message: 'Approve plans when you ask, for large plans or always.',
        });
      }
      patch.approvePlans = fields.approvePlans as PlanApproval;
    }
    return patch;
  });

  const resolveStatus = Effect.gen(function* () {
    const state = yield* definition.state;
    const completedAt = (yield* definition.machine).onboardedAt;
    const status: OnboardingStatus = {
      completed: completedAt !== null,
      completedAt,
      roots: {
        source: yield* roots.kind,
        configured: yield* roots.configured,
        fromEnvironment: yield* roots.fromEnvironment,
        effective: yield* roots.list,
      },
      defaults: {
        model: state.settings.defaultModel,
        mergeMethod: state.settings.mergeMethod,
      },
      paths: {
        home: paths.home,
        configPath: paths.configPath,
        dataDir: paths.dataDir,
        userHome,
      },
    };
    return status;
  });

  const listSuggestions = Effect.fn('Onboarding.listSuggestions')(function* (refresh: boolean) {
    const { candidates, truncated, refused } = yield* roots.discover(refresh);
    const chosen = new Set(yield* roots.configured);
    const suggestions: RootSuggestions = {
      suggestions: candidates.map((candidate) => ({ ...candidate, chosen: chosen.has(candidate.path) })),
      truncated,
      refused,
    };
    return suggestions;
  });

  const applySetup = Effect.fn('Onboarding.applySetup')(function* (fields: JsonObject, commandId?: string) {
    const chosen = yield* Effect.try({
      try: () => resolveChosenRoots(fields.roots, userHome),
      catch: resolveOnboardingFailure,
    });
    const defaults = yield* resolveDefaults(fields);
    if (Object.keys(defaults).length > 0) {
      yield* definition.dispatch(
        { type: 'settings.change', patch: defaults },
        commandId ? { id: commandId } : {}
      );
    }
    yield* definition.updateMachine({ roots: chosen });
    return yield* resolveStatus;
  });

  const resolvePrerequisites = Effect.gen(function* () {
    yield* definition.refreshInstallFolders;
    const bun = isBunUsed(yield* roots.list);
    return yield* resolvePrerequisiteReport({
      run: (command) => definition.run(command, userHome, { timeoutMs: PREREQUISITE_TIMEOUT_MS }),
      needs: { bun },
    });
  });

  const resolveContext = Effect.fn('Onboarding.resolveContext')(function* (revision: ProjectRevision | null) {
    const state = yield* definition.state;
    const configured = yield* roots.configured;
    const saveAnswer = Effect.fn('Onboarding.saveAnswer')(function* (patch: SetupPatch, commandId: string) {
      const saved = patch.roots ?? (yield* definition.machine).roots;
      yield* applySetup({ ...patch, roots: saved }, commandId);
    });
    const context: FlowContext = {
      userHome,
      settings: state.settings,
      roots: configured,
      projectCount: Object.keys(state.projects).length,
      suggestRoots: listSuggestions(false),
      suggestProjects: listProjectSuggestions(projects, configured, revision),
      listFiledProjects: Effect.map(definition.state, (current) => listFiledProjects(current, configured)),
      listModels: definition.listModels,
      listAccounts: definition.listAccounts,
      checkPrerequisites: resolvePrerequisites,
      save: saveAnswer,
      createProjects: (choices: OnboardingProjectChoice[] | undefined, commandId: string) =>
        createChosenProjects(projects, configured, choices, commandId, revision),
    };
    return context;
  });

  const recordWelcome = Effect.gen(function* () {
    if ((yield* definition.engineReadOnly) || selectWelcomeTask((yield* definition.state).tasks)) return;
    const context = yield* resolveContext(null);
    const steps = ONBOARDING_STEPS.filter((step) => step.id !== 'prerequisites');
    const lines = yield* Effect.forEach(
      steps,
      (step) => Effect.map(step.summarize(context), (summary) => ({ label: step.label, summary })),
      { concurrency: 'unbounded' }
    );
    yield* definition.dispatch({ type: 'onboarding.welcome', body: resolveWelcomeBody(lines) }, {});
  });

  const complete = Effect.gen(function* () {
    const machine = yield* definition.machine;
    if (machine.roots.length === 0) {
      return yield* new DomainError({
        code: 'roots_required',
        message: 'Choose your repository folders first.',
      });
    }
    if (machine.onboardedAt === null) {
      yield* definition.updateMachine({ onboardedAt: yield* Clock.currentTimeMillis });
    }
    yield* recordWelcome;
    return yield* resolveStatus;
  });

  const requestHelp = Effect.fn('Onboarding.requestHelp')(function* (checks: OnboardingCheck[]) {
    const events = yield* definition.dispatch(
      {
        type: 'task.create',
        request: resolveHelpRequest(checks),
        repoId: null,
        projectId: null,
        mode: 'ask',
      },
      {}
    );
    const created = events.find((event) => event.type === 'task.created');
    return created?.taskId ?? null;
  });

  const setup = yield* makeOnboardingSetup({
    path: join(paths.dataDir, 'onboarding.json'),
    steps: ONBOARDING_STEPS,
    readOnly: definition.inspect,
    newId: definition.newId,
    isCompleted: Effect.map(definition.machine, (machine) => machine.onboardedAt !== null),
    complete: Effect.asVoid(complete),
    requestHelp,
    selectWelcome: Effect.map(definition.state, (state) => selectWelcomeTask(state.tasks)?.id ?? null),
    reviseProjects: Effect.fn('Onboarding.reviseProjects')(function* (revision, text, choices) {
      const suggestions = yield* listProjectSuggestions(projects, yield* roots.configured, revision);
      return yield* requestRevision(definition.ask, suggestions, revision, text, choices);
    }),
    resolveContext,
  });

  const openPrivacySettings = Effect.map(
    definition.run(['open', PRIVACY_SETTINGS_URL], userHome),
    (result) => ({
      ok: result.ok,
    })
  );

  const openInstall = Effect.fn('Onboarding.openInstall')(function* (fields: JsonObject) {
    if (typeof fields.id !== 'string' && typeof fields.command !== 'string' && fields.all !== true) {
      return yield* new DomainError({
        code: 'body_invalid',
        message:
          'Send “id” as the check to fix, such as gh, “all” for every missing tool, or a “command” from the help task.',
      });
    }
    if (!terminals) {
      return yield* new DomainError({
        code: 'terminals_off',
        message: 'Terminals are off, so run the command yourself.',
      });
    }
    const open = (create: () => TerminalInfo) =>
      Effect.map(Effect.try({ try: create, catch: resolveOnboardingFailure }), (terminal) => ({ terminal }));
    const { id } = fields;
    if (typeof id === 'string') {
      return yield* open(() => openInstallTerminal(terminals, id, userHome, definition.scripts));
    }
    if (fields.all === true) {
      const report = yield* resolvePrerequisites;
      return yield* open(() =>
        openInstallAllTerminal(terminals, report.checks, userHome, definition.scripts)
      );
    }
    const helpId = yield* setup.selectHelp;
    const body = (helpId && (yield* definition.state).tasks[helpId]?.result?.body) || null;
    return yield* open(() =>
      openReplyTerminal(terminals, body, String(fields.command), userHome, definition.scripts)
    );
  });

  const handle: OnboardingHandle = {
    setup,
    resolveStatus,
    listSuggestions,
    applySetup,
    complete,
    openPrivacySettings,
    resolvePrerequisites,
    openInstall,
  };
  return handle;
});
