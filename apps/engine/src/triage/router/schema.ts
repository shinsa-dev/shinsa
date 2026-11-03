import type {
  DomainError,
  ShinsaCommand,
  ShinsaEvent,
  ShinsaState,
  Task,
  TaskShape,
  UserCommand,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { DispatchOptions } from '../../runtime/engine.ts';
import type { ClassifierFailed, MessageClass } from '../schema.ts';

export class CommandRouteFailed extends Schema.TaggedError<
  CommandRouteFailed,
  { readonly brand: unique symbol }
>()('CommandRouteFailed', { message: Schema.String }) {}

export type RouteSource = Pick<DispatchOptions, 'onBehalf' | 'byTask' | 'guest'>;

export type TaskMessage = Extract<UserCommand, { type: 'task.message' }>;

export interface ShapelessRound {
  task: Task;
  command: TaskMessage | Extract<UserCommand, { type: 'suggestion.keep' }>;
  request: string;
}

export interface RouteClassifier {
  readonly message: (task: Task, text: string) => Effect.Effect<MessageClass | null, ClassifierFailed>;
  readonly shape: (task: Task, request: string) => Effect.Effect<TaskShape | null, ClassifierFailed>;
}

type RouteFailure = DomainError | CommandRouteFailed | ClassifierFailed;

export interface CommandRouterDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly hasReceipt: (id: string) => Effect.Effect<boolean>;
  readonly dispatch: (
    command: ShinsaCommand,
    options: DispatchOptions
  ) => Effect.Effect<ShinsaEvent[], DomainError | CommandRouteFailed>;
}

export interface CommandRouterHandle {
  readonly route: (
    command: UserCommand,
    id: string | null,
    classify: RouteClassifier | null,
    from: RouteSource
  ) => Effect.Effect<ShinsaEvent[], RouteFailure>;
}
