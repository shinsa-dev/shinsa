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
  type ShinsaCommand,
  selectWelcomeTask,
  type TerminalInfo,
} from '@shinsa/core';
import { Clock, Context, Effect, Layer } from 'effect';
import { QuickCalls } from '../agents/quick/service.ts';
import type { MachineConfig } from '../config/machine/schema.ts';
import { EngineConfig } from '../config/service.ts';
import { ConfigStore } from '../config/store/service.ts';
import type { JsonObject } from '../http/schema.ts';
import { ProjectChanges } from '../projects/changes/service.ts';
import { CurrentLogin } from '../repos/current-login/service.ts';
import { RepoFolders } from '../repos/folders/service.ts';
import { Roots } from '../repos/roots/service.ts';
import type { DispatchOptions } from '../runtime/engine/schema.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { refreshInstallFolders } from '../shell/login.ts';
import { SetupCommands } from './commands/service.ts';
import { resolveOnboardingFailure } from './failures.ts';
import type { FlowContext } from './flow/schema.ts';
import { OnboardingSetup } from './flow/service.ts';
import { openInstallAllTerminal, openInstallTerminal, openReplyTerminal } from './install.ts';
import { isBunUsed } from './prerequisites/catalog.ts';
import { Prerequisites } from './prerequisites/service.ts';
import { createChosenProjects, listFiledProjects, listProjectSuggestions } from './projects.ts';
import type { ProjectSetup } from './projects/schema.ts';
import { requestRevision } from './revise.ts';
import { PRIVACY_SETTINGS_URL, resolveChosenRoots } from './roots.ts';
import {
  MODEL_ID,
  type OnboardingFailure,
  type OnboardingInput,
  type PrerequisiteReport,
  type ProjectRevision,
} from './schema.ts';
import { ONBOARDING_STEPS } from './steps.ts';
import type { SetupPatch } from './steps/schema.ts';
import { resolveHelpRequest, resolveWelcomeBody } from './welcome.ts';

export class Onboarding extends Context.Service<
  Onboarding,
  {
    readonly setup: OnboardingSetup['Service'];
    readonly resolveStatus: Effect.Effect<OnboardingStatus, OnboardingFailure>;
    readonly listSuggestions: (refresh: boolean) => Effect.Effect<RootSuggestions, OnboardingFailure>;
    readonly applySetup: (
      fields: JsonObject,
      commandId?: string
    ) => Effect.Effect<OnboardingStatus, OnboardingFailure>;
    readonly complete: Effect.Effect<OnboardingStatus, OnboardingFailure>;
    readonly openPrivacySettings: Effect.Effect<{ ok: boolean }>;
    readonly resolvePrerequisites: Effect.Effect<PrerequisiteReport, OnboardingFailure>;
    readonly openInstall: (
      fields: JsonObject
    ) => Effect.Effect<{ terminal: TerminalInfo }, OnboardingFailure>;
  }
>()('shinsa/engine/onboarding/Onboarding') {
  static readonly layer = (input: OnboardingInput) =>
    Layer.effect(
      Onboarding,
      Effect.gen(function* () {
        const folders = yield* RepoFolders;
        const config = yield* EngineConfig;
        const engine = yield* EngineCore;
        const store = yield* ConfigStore;
        const rootSource = yield* Roots;
        const changes = yield* ProjectChanges;
        const login = yield* CurrentLogin;
        const quick = yield* QuickCalls;
        const commands = yield* SetupCommands;
        const prerequisites = yield* Prerequisites;
        const { terminals } = input;
        const { userHome } = config;
        const paths = { home: config.home, configPath: config.configPath, dataDir: config.dataDir, userHome };
        const roots = {
          configured: rootSource.configured,
          fromEnvironment: Effect.succeed([...rootSource.fromEnvironment]),
          kind: rootSource.kind,
          list: rootSource.listRoots,
          discover: rootSource.discover,
        };

        const dispatch = (command: ShinsaCommand, options: DispatchOptions) =>
          engine.dispatch(command, options).pipe(Effect.mapError(resolveOnboardingFailure));

        const updateMachine = (patch: Partial<Omit<MachineConfig, 'version'>>) =>
          Effect.asVoid(Effect.orDie(store.update(patch)));

        const projects: ProjectSetup = {
          state: engine.state,
          login: login.lookup,
          dispatch: (command, id) => Effect.asVoid(dispatch(command, { id })),
          upsertRepo: (projectId, path, id) =>
            changes
              .upsertRepo(projectId, path, { id })
              .pipe(Effect.mapError(resolveOnboardingFailure), Effect.asVoid),
          listLocal: (list, limit) => folders.listLocal(list, limit),
          readOrigin: (repo) => folders.readOrigin(repo),
        };

        const resolveDefaults = Effect.fn('Onboarding.resolveDefaults')(function* (fields: JsonObject) {
          const patch: Partial<Settings> = {};
          if (fields.defaultModel !== undefined) {
            const model = fields.defaultModel;
            if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model))) {
              return yield* new DomainError({
                code: 'model_invalid',
                message: 'Pick a model from the list.',
              });
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
          const state = yield* engine.state;
          const completedAt = (yield* store.config).onboardedAt;
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
            suggestions: candidates.map((candidate) => ({
              ...candidate,
              chosen: chosen.has(candidate.path),
            })),
            truncated,
            refused,
          };
          return suggestions;
        });

        const applySetup = Effect.fn('Onboarding.applySetup')(function* (
          fields: JsonObject,
          commandId?: string
        ) {
          const chosen = yield* Effect.try({
            try: () => resolveChosenRoots(fields.roots, userHome),
            catch: resolveOnboardingFailure,
          });
          const defaults = yield* resolveDefaults(fields);
          if (Object.keys(defaults).length > 0) {
            yield* dispatch({ type: 'settings.change', patch: defaults }, commandId ? { id: commandId } : {});
          }
          yield* updateMachine({ roots: chosen });
          return yield* resolveStatus;
        });

        const resolvePrerequisites = Effect.gen(function* () {
          yield* Effect.sync(() => refreshInstallFolders(Bun.env, userHome));
          return yield* prerequisites.resolve(userHome, { bun: isBunUsed(yield* roots.list) });
        });

        const resolveContext = Effect.fn('Onboarding.resolveContext')(function* (
          revision: ProjectRevision | null
        ) {
          const state = yield* engine.state;
          const configured = yield* roots.configured;
          const saveAnswer = Effect.fn('Onboarding.saveAnswer')(function* (
            patch: SetupPatch,
            commandId: string
          ) {
            const saved = patch.roots ?? (yield* store.config).roots;
            yield* applySetup({ ...patch, roots: saved }, commandId);
          });
          const context: FlowContext = {
            userHome,
            settings: state.settings,
            roots: configured,
            projectCount: Object.keys(state.projects).length,
            suggestRoots: listSuggestions(false),
            suggestProjects: listProjectSuggestions(projects, configured, revision),
            listFiledProjects: Effect.map(engine.state, (current) => listFiledProjects(current, configured)),
            listModels: input.models.listModels,
            listAccounts: input.accounts,
            checkPrerequisites: resolvePrerequisites,
            save: saveAnswer,
            createProjects: (choices: OnboardingProjectChoice[] | undefined, commandId: string) =>
              createChosenProjects(projects, configured, choices, commandId, revision),
          };
          return context;
        });

        const recordWelcome = Effect.gen(function* () {
          if (engine.readOnly || selectWelcomeTask((yield* engine.state).tasks)) return;
          const context = yield* resolveContext(null);
          const steps = ONBOARDING_STEPS.filter((step) => step.id !== 'prerequisites');
          const lines = yield* Effect.forEach(
            steps,
            (step) => Effect.map(step.summarize(context), (summary) => ({ label: step.label, summary })),
            { concurrency: 'unbounded' }
          );
          yield* dispatch({ type: 'onboarding.welcome', body: resolveWelcomeBody(lines) }, {});
        });

        const complete = Effect.gen(function* () {
          const machine = yield* store.config;
          if (machine.roots.length === 0) {
            return yield* new DomainError({
              code: 'roots_required',
              message: 'Choose your repository folders first.',
            });
          }
          if (machine.onboardedAt === null) {
            yield* updateMachine({ onboardedAt: yield* Clock.currentTimeMillis });
          }
          yield* recordWelcome;
          return yield* resolveStatus;
        });

        const requestHelp = Effect.fn('Onboarding.requestHelp')(function* (checks: OnboardingCheck[]) {
          const events = yield* dispatch(
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

        const setup = Context.get(
          yield* Layer.build(
            OnboardingSetup.layer({
              path: join(paths.dataDir, 'onboarding.json'),
              steps: ONBOARDING_STEPS,
              readOnly: config.inspect,
              newId: Effect.sync(() => Bun.randomUUIDv7()),
              isCompleted: Effect.map(store.config, (machine) => machine.onboardedAt !== null),
              complete: Effect.asVoid(complete),
              requestHelp,
              selectWelcome: Effect.map(engine.state, (state) => selectWelcomeTask(state.tasks)?.id ?? null),
              reviseProjects: Effect.fn('Onboarding.reviseProjects')(function* (revision, text, choices) {
                const suggestions = yield* listProjectSuggestions(
                  projects,
                  yield* roots.configured,
                  revision
                );
                return yield* requestRevision(
                  (system, prompt, schema) => quick.write<unknown>(system, prompt, schema),
                  suggestions,
                  revision,
                  text,
                  choices
                );
              }),
              resolveContext,
            })
          ),
          OnboardingSetup
        );

        const openPrivacySettings = Effect.map(
          commands.run(['open', PRIVACY_SETTINGS_URL], userHome),
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
          const { id } = fields;
          if (typeof id === 'string') {
            return { terminal: yield* openInstallTerminal(terminals, id, userHome, commands.scripts) };
          }
          if (fields.all === true) {
            const report = yield* resolvePrerequisites;
            return {
              terminal: yield* openInstallAllTerminal(terminals, report.checks, userHome, commands.scripts),
            };
          }
          const helpId = yield* setup.selectHelp;
          const body = (helpId && (yield* engine.state).tasks[helpId]?.result?.body) || null;
          return {
            terminal: yield* openReplyTerminal(
              terminals,
              body,
              String(fields.command),
              userHome,
              commands.scripts
            ),
          };
        });

        return Onboarding.of({
          setup,
          resolveStatus,
          listSuggestions,
          applySetup,
          complete,
          openPrivacySettings,
          resolvePrerequisites,
          openInstall,
        });
      })
    );
}
