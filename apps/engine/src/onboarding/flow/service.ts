import {
  DomainError,
  type OnboardingFlow,
  type OnboardingProjectChoice,
  type OnboardingReply,
  type OnboardingStep,
  type OnboardingStepId,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect';
import { JsonFile } from '../../files/service.ts';
import type { JsonObject } from '../../http/schema.ts';
import { isPrivateFolders } from '../roots.ts';
import { type OnboardingFailure, SetupDraft } from '../schema.ts';
import type { StepDefinition, StepReadContext } from '../steps/schema.ts';
import { listFailingChecks } from '../welcome.ts';
import { AnswerValues, type FlowDefinition, ProjectChoices, ReplyType } from './schema.ts';

export class OnboardingSetup extends Context.Service<
  OnboardingSetup,
  {
    readonly resolve: Effect.Effect<OnboardingFlow, OnboardingFailure>;
    readonly selectHelp: Effect.Effect<string | null>;
    readonly reply: (fields: JsonObject) => Effect.Effect<OnboardingFlow, OnboardingFailure>;
  }
>()('shinsa/engine/onboarding/flow/OnboardingSetup') {
  static readonly layer = (definition: FlowDefinition) =>
    Layer.effect(
      OnboardingSetup,
      Effect.gen(function* () {
        const file = yield* JsonFile;
        const serial = yield* Semaphore.make(1);
        const current = yield* Ref.make<SetupDraft | null>(null);
        const { steps, path } = definition;
        const decodeDraft = Schema.decodeUnknownEffect(SetupDraft);
        const decodeType = Schema.decodeUnknownOption(ReplyType);
        const decodeValues = Schema.decodeUnknownOption(AnswerValues);
        const decodeProjects = Schema.decodeUnknownOption(ProjectChoices);

        const parseStepId = Effect.fn('OnboardingSetup.parseStepId')(function* (value: unknown) {
          const step = steps.find((entry) => entry.id === value);
          if (!step) return yield* new DomainError({ code: 'step_invalid', message: 'Name a setup step.' });
          return step.id;
        });

        const parseProjects = Effect.fn('OnboardingSetup.parseProjects')(function* (value: unknown) {
          if (value === undefined) return {};
          const projects = decodeProjects(value);
          if (Option.isNone(projects)) {
            return yield* new DomainError({
              code: 'projects_invalid',
              message: 'Send each project as its id, name and repositories.',
            });
          }
          return { projects: projects.value };
        });

        const parseReply = Effect.fn('OnboardingSetup.parseReply')(function* (fields: JsonObject) {
          const type = Option.getOrNull(decodeType(fields.type));
          if (type === 'restart') return { type } satisfies OnboardingReply;
          if (type === 'open')
            return { type, stepId: yield* parseStepId(fields.stepId) } satisfies OnboardingReply;
          if (type === 'help')
            return { type, stepId: yield* parseStepId(fields.stepId) } satisfies OnboardingReply;
          if (type === 'answer') {
            const stepId = yield* parseStepId(fields.stepId);
            const values = decodeValues(fields.values);
            if (Option.isNone(values)) {
              return yield* new DomainError({ code: 'values_invalid', message: 'Pick at least one option.' });
            }
            const projects = yield* parseProjects(fields.projects);
            return { type, stepId, values: values.value, ...projects } satisfies OnboardingReply;
          }
          if (type === 'revise') {
            const stepId = yield* parseStepId(fields.stepId);
            const { text } = fields;
            if (typeof text !== 'string') {
              return yield* new DomainError({ code: 'request_invalid', message: 'Say what to change.' });
            }
            const projects = yield* parseProjects(fields.projects);
            return { type, stepId, text, ...projects } satisfies OnboardingReply;
          }
          return yield* new DomainError({
            code: 'reply_invalid',
            message: 'Answer a step, open one, ask for help or start again.',
          });
        });

        const readDraft = file.read(path, Schema.Unknown).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed<SetupDraft | null>(null),
              onSome: (value) =>
                decodeDraft(value).pipe(
                  Effect.catchTag('SchemaError', () =>
                    Effect.logWarning(
                      '[Onboarding] The saved setup is not one Shinsa wrote; starting again'
                    ).pipe(Effect.annotateLogs({ path }), Effect.as(null))
                  )
                ),
            })
          ),
          Effect.catchTag('JsonFileUnreadable', (unreadable) =>
            Effect.logWarning('[Onboarding] The saved setup could not be read; starting again').pipe(
              Effect.annotateLogs({ path, error: unreadable.reason }),
              Effect.as(null)
            )
          )
        );

        const write = Effect.fn('OnboardingSetup.write')(function* (draft: SetupDraft) {
          yield* Ref.set(current, draft);
          if (!definition.readOnly) yield* file.write(path, draft).pipe(Effect.orDie);
          return draft;
        });

        const start = Effect.gen(function* () {
          const draft: SetupDraft = {
            version: 6,
            id: yield* definition.newId,
            index: 0,
            furthest: 0,
            saves: 0,
            revisit: yield* definition.isCompleted,
            problem: null,
            access: [],
            picked: [],
            revision: null,
            help: null,
          };
          return yield* write(draft);
        });

        const open = Effect.gen(function* () {
          const draft = (yield* Ref.get(current)) ?? (yield* readDraft);
          if (!draft) return yield* start;
          yield* Ref.set(current, draft);
          const finished = draft.index >= steps.length;
          if (finished && !(yield* definition.isCompleted)) return yield* start;
          return draft;
        });

        const assertReached = Effect.fn('OnboardingSetup.assertReached')(function* (
          draft: SetupDraft,
          index: number
        ) {
          if (draft.index >= steps.length) {
            return yield* new DomainError({
              code: 'setup_finished',
              message: 'Setup is done. Restart it in Settings.',
            });
          }
          if (!draft.revisit && index > draft.furthest) {
            return yield* new DomainError({
              code: 'step_unreached',
              message: 'Answer the steps before this one first.',
            });
          }
        });

        const move = (draft: SetupDraft, index: number) =>
          write({
            ...draft,
            index,
            furthest: Math.max(draft.furthest, index),
            problem: null,
            access: [],
            picked: [],
          });

        const revise = Effect.fn('OnboardingSetup.revise')(function* (
          draft: SetupDraft,
          stepId: OnboardingStepId,
          text: string,
          projects: OnboardingProjectChoice[] | undefined
        ) {
          if (stepId !== 'projects') {
            return yield* new DomainError({
              code: 'revise_invalid',
              message: 'Only suggested projects can change.',
            });
          }
          const revised = yield* definition.reviseProjects(draft.revision, text, projects).pipe(
            Effect.map((revision): SetupDraft => ({ ...draft, revision, problem: null })),
            Effect.catchTag('DomainError', (error) => Effect.succeed({ ...draft, problem: error.message }))
          );
          return yield* write(revised);
        });

        const help = Effect.fn('OnboardingSetup.help')(function* (draft: SetupDraft, step: StepDefinition) {
          const view = yield* step.view(
            yield* definition.resolveContext(draft.revision),
            false,
            draft.picked
          );
          const failing = listFailingChecks(view.checks);
          if (failing.length === 0) {
            return yield* new DomainError({
              code: 'help_unneeded',
              message: 'Every check on this step passes, so there is nothing to ask about.',
            });
          }
          return yield* write({ ...draft, help: yield* definition.requestHelp(failing) });
        });

        const answer = Effect.fn('OnboardingSetup.answer')(function* (
          draft: SetupDraft,
          stepId: OnboardingStepId,
          values: string[],
          projects: OnboardingProjectChoice[] | undefined
        ) {
          const step = steps[draft.index] as StepDefinition;
          const context = yield* definition.resolveContext(draft.revision);
          const commandId = `setup:${draft.id}:${stepId}:${draft.saves}`;
          const refusal = yield* step
            .answer(
              values,
              {
                ...context,
                save: (patch) => context.save(patch, commandId),
                createProjects: (choices) => context.createProjects(choices, commandId),
              },
              projects
            )
            .pipe(
              Effect.as(null),
              Effect.catchTag('DomainError', (error) => Effect.succeed(error))
            );
          if (refusal) {
            const refused = isPrivateFolders(refusal);
            return yield* write({
              ...draft,
              problem: refused ? null : refusal.message,
              access: refused ? refusal.folders : [],
              picked: refused ? refusal.picked : [],
            });
          }
          if (draft.index === steps.length - 1) yield* definition.complete;
          return yield* move({ ...draft, saves: draft.saves + 1 }, draft.index + 1);
        });

        const summarize = (
          draft: SetupDraft,
          step: StepDefinition,
          index: number,
          context: StepReadContext
        ) => {
          const answered = draft.revisit || index < draft.furthest;
          if (!answered || index === draft.index) return Effect.succeed(null);
          return step.summarize(context);
        };

        const view = Effect.fn('OnboardingSetup.view')(function* (
          draft: SetupDraft,
          step: StepDefinition | undefined,
          context: StepReadContext
        ) {
          if (!step) return null;
          const answered = draft.revisit || draft.index < draft.furthest;
          const shown = yield* step.view(context, answered, draft.picked);
          const onScreen: OnboardingStep = {
            id: step.id,
            ...shown,
            conversation: step.id === 'projects' ? (draft.revision?.turns ?? []) : [],
            problem: draft.problem,
            access: draft.access,
            help: draft.help,
          };
          return onScreen;
        });

        const present = Effect.fn('OnboardingSetup.present')(function* (draft: SetupDraft) {
          const context = yield* definition.resolveContext(draft.revision);
          const entries = yield* Effect.forEach(
            steps,
            (step, index) =>
              Effect.map(summarize(draft, step, index, context), (summary) => ({
                id: step.id,
                label: step.label,
                summary,
                reached: draft.revisit || index <= draft.furthest,
              })),
            { concurrency: 'unbounded' }
          );
          const flow: OnboardingFlow = {
            steps: entries,
            index: draft.index,
            step: yield* view(draft, steps[draft.index], context),
            revisit: draft.revisit,
            welcome: yield* definition.selectWelcome,
          };
          return flow;
        });

        const reply = Effect.fn('OnboardingSetup.reply')(
          function* (fields: JsonObject) {
            const parsed = yield* parseReply(fields);
            if (parsed.type === 'restart') return yield* present(yield* start);
            const draft = yield* open;
            const index = steps.findIndex((step) => step.id === parsed.stepId);
            if (parsed.type === 'open') {
              yield* assertReached(draft, index);
              return yield* present(yield* move(draft, index));
            }
            if (index !== draft.index) {
              return yield* new DomainError({ code: 'step_stale', message: 'That step has closed.' });
            }
            if (parsed.type === 'help')
              return yield* present(yield* help(draft, steps[index] as StepDefinition));
            if (parsed.type === 'revise') {
              return yield* present(yield* revise(draft, parsed.stepId, parsed.text, parsed.projects));
            }
            return yield* present(yield* answer(draft, parsed.stepId, parsed.values, parsed.projects));
          },
          (effect) => Semaphore.withPermit(serial, effect)
        );

        return OnboardingSetup.of({
          resolve: Semaphore.withPermit(serial, Effect.flatMap(open, present)),
          selectHelp: Semaphore.withPermit(
            serial,
            Effect.map(open, (draft) => draft.help)
          ),
          reply,
        });
      })
    );
}
