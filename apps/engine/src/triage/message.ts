import { DomainError, type ShinsaState, type Task, type UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import type { CommandRouter } from '../agents/manage/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/redact.ts';
import type { LocalRepo } from '../repos/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { resolveQuickAsk } from './classify.ts';
import { makeTriageClassifier } from './message/service.ts';
import { CommandRouteFailed, type CommandRouterHandle, type RouteSource } from './router/schema.ts';
import { makeCommandRouter } from './router/service.ts';
import { type Classifier, ClassifierFailed } from './schema.ts';

export { resolveMessageRoute } from './routes.ts';
export type {
  Classifier,
  MessageClass,
  MessageClassifier,
  RepositoryFinder,
  ShapeClassifier,
} from './schema.ts';

function resolveClassifierHandle(ask: QuickJson) {
  return makeTriageClassifier({ ask: resolveQuickAsk(ask) });
}

export function resolveMessageClass(task: Task, text: string, ask: QuickJson) {
  return edgeRuntime.runPromise(resolveClassifierHandle(ask).message(task, text));
}

export function resolveRoundShape(task: Task, request: string, ask: QuickJson) {
  return edgeRuntime.runPromise(resolveClassifierHandle(ask).shape(task, request));
}

export function resolveRoundRepository(state: ShinsaState, task: Task, local: LocalRepo[], ask: QuickJson) {
  return edgeRuntime.runPromise(resolveClassifierHandle(ask).repository(state, task, local));
}

export function createClassifier(ask: QuickJson): Classifier {
  const handle = resolveClassifierHandle(ask);
  return {
    message: (task, text) => edgeRuntime.runPromise(handle.message(task, text)),
    shape: (task, request) => edgeRuntime.runPromise(handle.shape(task, request)),
  };
}

function classifierFailed(error: unknown) {
  return new ClassifierFailed({ message: describeError(error) });
}

const routers = new WeakMap<Engine, CommandRouterHandle>();

function resolveRouter(engine: Engine) {
  const known = routers.get(engine);
  if (known) return known;
  const router = edgeRuntime.runSync(
    makeCommandRouter({
      state: Effect.sync(() => engine.state),
      hasReceipt: (id) => Effect.sync(() => engine.hasReceipt(id)),
      dispatch: (command, options) =>
        Effect.tryPromise({
          try: () => engine.dispatch(command, options),
          catch: (error) =>
            error instanceof DomainError ? error : new CommandRouteFailed({ message: describeError(error) }),
        }),
    })
  );
  routers.set(engine, router);
  return router;
}

export function routeUserCommand(
  engine: Engine,
  command: UserCommand,
  id: string | null,
  classify: Classifier | null,
  from: RouteSource = {}
) {
  const routed = classify
    ? {
        message: (task: Task, text: string) =>
          Effect.tryPromise({ try: () => classify.message(task, text), catch: classifierFailed }),
        shape: (task: Task, request: string) =>
          Effect.tryPromise({ try: () => classify.shape(task, request), catch: classifierFailed }),
      }
    : null;
  return edgeRuntime.runPromise(resolveRouter(engine).route(command, id, routed, from));
}

export function createCommandRouter(engine: Engine, classify: Classifier | null): CommandRouter {
  return (command, from) => routeUserCommand(engine, command, from.id ?? null, classify, from);
}
