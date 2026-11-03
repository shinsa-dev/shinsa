import { isTaskResting, needsMessageKind, type ShinsaState, type UserCommand } from '@shinsa/core';
import { Deferred, Effect, Ref } from 'effect';
import type { DispatchOptions } from '../../runtime/engine.ts';
import { resolveMessageRoute } from '../routes.ts';
import type { ClassifierFailed } from '../schema.ts';
import type {
  CommandRouterDefinition,
  CommandRouterHandle,
  RouteClassifier,
  RouteSource,
  ShapelessRound,
  TaskMessage,
} from './schema.ts';

export const makeCommandRouter = Effect.fn('CommandRouter.make')(function* (
  definition: CommandRouterDefinition
) {
  const pending = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<UserCommand, ClassifierFailed>>>(
    new Map()
  );

  const selectShapelessRound = (state: ShinsaState, command: UserCommand): ShapelessRound | null => {
    if (command.type !== 'task.message' && command.type !== 'suggestion.keep') return null;
    const task = state.tasks[command.taskId];
    if (!task || command.shape) return null;
    if (command.type === 'task.message') {
      return command.kind === 'new_round' ? { task, command, request: command.text } : null;
    }
    if (!isTaskResting(task)) return null;
    const suggestion = task.suggestions?.find((candidate) => candidate.id === command.suggestionId);
    return suggestion?.status === 'open' ? { task, command, request: suggestion.request } : null;
  };

  const classifyCommand = Effect.fn('CommandRouter.classify')(function* (
    classify: RouteClassifier,
    command: TaskMessage
  ) {
    const state = yield* definition.state;
    const task = state.tasks[command.taskId];
    if (!task || !needsMessageKind(state, task)) return command;
    return { ...command, ...resolveMessageRoute(yield* classify.message(task, command.text)) };
  });

  const shapeCommand = Effect.fn('CommandRouter.shape')(function* (
    classify: RouteClassifier,
    { task, command, request }: ShapelessRound
  ) {
    const shape = yield* classify.shape(task, request);
    return shape ? { ...command, shape } : command;
  });

  const forget = (id: string) =>
    Ref.update(pending, (current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  const routeOnce = Effect.fn('CommandRouter.routeOnce')(function* (
    command: UserCommand,
    options: DispatchOptions & { id: string },
    resolve: Effect.Effect<UserCommand, ClassifierFailed>
  ) {
    const fresh = yield* Deferred.make<UserCommand, ClassifierFailed>();
    const shared = yield* Ref.modify(pending, (current) => {
      const found = current.get(options.id);
      return found ? [found, current] : [fresh, new Map(current).set(options.id, fresh)];
    });
    const sent = { ...options, receipt: command };
    if (shared !== fresh) return yield* definition.dispatch(yield* Deferred.await(shared), sent);
    return yield* Deferred.complete(fresh, resolve).pipe(
      Effect.andThen(Deferred.await(fresh)),
      Effect.flatMap((routed) => definition.dispatch(routed, sent)),
      Effect.ensuring(forget(options.id))
    );
  });

  const routeResolved = Effect.fn('CommandRouter.routeResolved')(function* (
    command: UserCommand,
    id: string | null,
    from: RouteSource,
    resolve: Effect.Effect<UserCommand, ClassifierFailed>
  ) {
    if (id) return yield* routeOnce(command, { ...from, id }, resolve);
    return yield* definition.dispatch(yield* resolve, { ...from, receipt: command });
  });

  const route = Effect.fn('CommandRouter.route')(function* (
    command: UserCommand,
    id: string | null,
    classify: RouteClassifier | null,
    from: RouteSource
  ) {
    const plain = id ? { ...from, id } : from;
    if (!classify || (id && (yield* definition.hasReceipt(id))))
      return yield* definition.dispatch(command, plain);
    const shapeless = selectShapelessRound(yield* definition.state, command);
    if (shapeless) return yield* routeResolved(command, id, from, shapeCommand(classify, shapeless));
    if (command.type !== 'task.message' || command.kind) return yield* definition.dispatch(command, plain);
    if (!(from.onBehalf || from.byTask || from.guest)) {
      const { taskId, text } = command;
      return yield* definition.dispatch(
        { type: 'message.receive', taskId, text },
        { ...(id ? { id } : {}), receipt: command }
      );
    }
    return yield* routeResolved(command, id, from, classifyCommand(classify, command));
  });

  const handle: CommandRouterHandle = { route };
  return handle;
});
