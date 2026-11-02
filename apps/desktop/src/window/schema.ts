import { Schema } from 'effect';

export const Rect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

export type Rect = typeof Rect.Type;

export const DEFAULT_SIZE = { width: 900, height: 1100 };

export const MIN_SIZE = { width: 480, height: 480 };

export const SavedBounds = Rect.check(
  Schema.makeFilter((rect) => rect.width >= MIN_SIZE.width && rect.height >= MIN_SIZE.height)
);

export const VISIBLE_EDGE = 64;

export const CloseAction = Schema.Literals(['close', 'hide', 'leave-full-screen']);

export type CloseAction = typeof CloseAction.Type;
