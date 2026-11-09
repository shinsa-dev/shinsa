import { BunServices } from '@effect/platform-bun';
import type { PresetShape, ShinsaState, Task, TaskShape, UserCommand } from '@shinsa/core';
import { Context, Duration, Effect, Layer, Scope } from 'effect';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import { describeError } from '../../src/log/redact.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { LocalRepo } from '../../src/repos/index.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import {
  ClassifyTimeout,
  CommandRouter,
  type MessageClass,
  MessageInbox,
  type RouteSource,
  TaskTriage,
  type TeamReading,
  TriageClassifier,
  TriageTeam,
} from '../../src/triage/index.ts';
import { ClassifierFailed } from '../../src/triage/schema.ts';
import type { Engine } from '../helpers/engine.ts';
import { promised } from '../helpers/promised.ts';

export type { MessageClass } from '../../src/triage/index.ts';
export { resolveMessageRoute } from '../../src/triage/index.ts';

export type MessageClassifier = (task: Task, text: string) => Promise<MessageClass | null>;

export type ShapeClassifier = (task: Task, request: string) => Promise<PresetShape | null>;

export interface Classifier {
  message: MessageClassifier;
  shape: ShapeClassifier;
}

function build<I, S>(layer: Layer.Layer<I>, tag: Context.Key<I, S>): S {
  const logged = layer.pipe(Layer.provide(JsonLogger));
  return Context.get(Effect.runSync(Layer.buildWithScope(logged, Effect.runSync(Scope.make()))), tag);
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.provide(JsonLogger)));
}

function quickLayer(ask: QuickJson) {
  return Layer.succeed(QuickCalls, QuickCalls.of({ classify: ask, write: ask }));
}

function failed(error: unknown) {
  return new ClassifierFailed({ message: describeError(error) });
}

const notAsked = () => Promise.reject(new Error('not asked'));

function createClassifierLayer(classify: Partial<Classifier>) {
  const message = classify.message ?? notAsked;
  const shape = classify.shape ?? notAsked;
  return Layer.succeed(
    TriageClassifier,
    TriageClassifier.of({
      message: (task, text) => Effect.tryPromise({ try: () => message(task, text), catch: failed }),
      shape: (task, request) => Effect.tryPromise({ try: () => shape(task, request), catch: failed }),
      repository: () => Effect.succeed(null),
    })
  );
}

function buildClassifier(ask: QuickJson) {
  return build(
    TriageClassifier.layer.pipe(Layer.provide(quickLayer(ask)), Layer.provide(BunServices.layer)),
    TriageClassifier
  );
}

export function createClassifier(ask: QuickJson): Classifier {
  const classifier = buildClassifier(ask);
  return {
    message: (task, text) => run(classifier.message(task, text)),
    shape: (task, request) => run(classifier.shape(task, request)),
  };
}

export function resolveMessageClass(task: Task, text: string, ask: QuickJson) {
  return run(buildClassifier(ask).message(task, text));
}

export function resolveRoundShape(task: Task, request: string, ask: QuickJson) {
  return run(buildClassifier(ask).shape(task, request));
}

export function resolveRoundRepository(state: ShinsaState, task: Task, local: LocalRepo[], ask: QuickJson) {
  return run(buildClassifier(ask).repository(state, task, local));
}

export function resolveTriageEffect(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson,
  team: (() => TeamReading) | null = null
) {
  const layer = TaskTriage.layer.pipe(
    Layer.provide(quickLayer(ask)),
    Layer.provide(team ? Layer.succeed(TriageTeam, Effect.sync(team)) : Layer.empty),
    Layer.provide(BunServices.layer)
  );
  return build(layer, TaskTriage).resolve(state, task, local);
}

export function resolveTriage(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson,
  team: (() => TeamReading) | null = null
) {
  return run(resolveTriageEffect(state, task, local, ask, team));
}

const routers = new WeakMap<
  Engine,
  WeakMap<MessageClassifier, WeakMap<ShapeClassifier, CommandRouter['Service']>>
>();

function resolveRouter(engine: Engine, classify: Classifier) {
  const byMessage = routers.get(engine) ?? new WeakMap();
  routers.set(engine, byMessage);
  const byShape = byMessage.get(classify.message) ?? new WeakMap();
  byMessage.set(classify.message, byShape);
  const known = byShape.get(classify.shape);
  if (known) return known;
  const router = build(
    CommandRouter.layer.pipe(
      Layer.provide(createClassifierLayer(classify)),
      Layer.provide(Layer.succeed(EngineCore, engine.core))
    ),
    CommandRouter
  );
  byShape.set(classify.shape, router);
  return router;
}

export function routeUserCommand(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  classify: Classifier | null,
  from: RouteSource = {}
) {
  if (!classify) return engine.dispatch(command, id ? { ...from, id } : from);
  return run(resolveRouter(engine, classify).route(command, id ? { ...from, id } : from));
}

export function createManageRoute(engine: Engine, classify: Classifier) {
  const router = resolveRouter(engine, classify);
  return router.route;
}

export function createCommandRouter(engine: Engine, classify: Classifier | null) {
  return (command: UserCommand, from: RouteSource & { id?: string }) =>
    routeUserCommand(engine, command, from.id ?? null, classify, from);
}

export function createInbox(
  engine: Engine,
  classify: MessageClassifier,
  options: { classifyTimeoutMs?: number } = {}
) {
  const layer = MessageInbox.layer.pipe(
    Layer.provide(createClassifierLayer({ message: classify })),
    Layer.provide(Layer.succeed(EngineCore, engine.core)),
    Layer.provide(
      options.classifyTimeoutMs === undefined
        ? Layer.empty
        : Layer.succeed(ClassifyTimeout, Duration.millis(options.classifyTimeoutMs))
    )
  );
  return promised(build(layer, MessageInbox));
}
