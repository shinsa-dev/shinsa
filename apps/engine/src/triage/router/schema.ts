import type { DomainError, Task, UserCommand } from '@shinsa/core';
import { Schema } from 'effect';
import type { DispatchOptions, EngineStopped } from '../../runtime/engine/schema.ts';
import type { ClassifierFailed } from '../schema.ts';

export type RouteSource = Pick<DispatchOptions, 'onBehalf' | 'byTask' | 'guest' | 'actor'>;

export type TaskMessage = Extract<UserCommand, { type: 'task.message' }>;

export interface ShapelessRound {
  task: Task;
  command: TaskMessage | Extract<UserCommand, { type: 'suggestion.keep' }>;
  request: string;
}

export class CommandRouteFailed extends Schema.TaggedError<
  CommandRouteFailed,
  { readonly brand: unique symbol }
>()('CommandRouteFailed', { message: Schema.String }) {}

export type RouteFailure = DomainError | EngineStopped | CommandRouteFailed | ClassifierFailed;
