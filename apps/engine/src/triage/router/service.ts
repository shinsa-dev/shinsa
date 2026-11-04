import {
  isTaskResting,
  needsMessageKind,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  type UserCommand,
} from '@shinsa/core';
import { Context, Deferred, Effect, Layer, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { TriageClassifier } from '../message/service.ts';
import { resolveMessageRoute } from '../routes.ts';
import type { ClassifierFailed } from '../schema.ts';
import {
  CommandRouteFailed,
  type RouteFailure,
  type RouteSource,
  type ShapelessRound,
  type TaskMessage,
} from './schema.ts';

export class CommandRouter extends Context.Service<
  CommandRouter,
  {
    readonly route: (
      command: UserCommand,
      from?: RouteSource & { readonly id?: string }
    ) => Effect.Effect<ShinsaEvent[], RouteFailure>;
  }
>()('shinsa/engine/triage/router/CommandRouter') {
  static readonly layer = Layer.effect(
    CommandRouter,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const classify = yield* TriageClassifier;

      const dispatch = (command: ShinsaCommand, options: DispatchOptions) =>
        engine
          .dispatch(command, options)
          .pipe(
            Effect.catchDefect((defect) =>
              Effect.fail(new CommandRouteFailed({ message: describeError(defect) }))
            )
          );
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

      const classifyCommand = Effect.fn('CommandRouter.classify')(function* (command: TaskMessage) {
        const state = yield* engine.state;
        const task = state.tasks[command.taskId];
        if (!task || !needsMessageKind(state, task)) return command;
        return { ...command, ...resolveMessageRoute(yield* classify.message(task, command.text)) };
      });

      const shapeCommand = Effect.fn('CommandRouter.shape')(function* ({
        task,
        command,
        request,
      }: ShapelessRound) {
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
        if (shared !== fresh) return yield* dispatch(yield* Deferred.await(shared), sent);
        return yield* Deferred.complete(fresh, resolve).pipe(
          Effect.andThen(Deferred.await(fresh)),
          Effect.flatMap((routed) => dispatch(routed, sent)),
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
        return yield* dispatch(yield* resolve, { ...from, receipt: command });
      });

      const route = Effect.fn('CommandRouter.route')(function* (
        command: UserCommand,
        plain: RouteSource & { readonly id?: string } = {}
      ) {
        const { id = null, ...from } = plain;
        if (id && (yield* engine.hasReceipt(id))) return yield* dispatch(command, plain);
        const shapeless = selectShapelessRound(yield* engine.state, command);
        if (shapeless) return yield* routeResolved(command, id, from, shapeCommand(shapeless));
        if (command.type !== 'task.message' || command.kind) return yield* dispatch(command, plain);
        if (!(from.onBehalf || from.byTask || from.guest)) {
          const { taskId, text } = command;
          return yield* dispatch(
            { type: 'message.receive', taskId, text },
            { ...(id ? { id } : {}), receipt: command }
          );
        }
        return yield* routeResolved(command, id, from, classifyCommand(command));
      });

      return CommandRouter.of({ route });
    })
  );
}
