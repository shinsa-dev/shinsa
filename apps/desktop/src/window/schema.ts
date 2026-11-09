import { type Effect, Schema } from 'effect';

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

export const Page = Schema.Literals(['none', 'app', 'waiting']);

export type Page = typeof Page.Type;

export const ABORTED_LOAD = -3;

export const NativeWindowEvent = Schema.Union([
  Schema.TaggedStruct('FullScreen', { on: Schema.Boolean }),
  Schema.TaggedStruct('LoadFailed', { code: Schema.Int, mainFrame: Schema.Boolean }),
  Schema.TaggedStruct('RendererGone', {}),
]);

export type NativeWindowEvent = typeof NativeWindowEvent.Type;

export const SenderFrame = Schema.Struct({
  contentsId: Schema.Int,
  url: Schema.NullOr(Schema.String),
  top: Schema.Boolean,
});

export type SenderFrame = typeof SenderFrame.Type;

export const NavigationHistory = Schema.Struct({ urls: Schema.Array(Schema.String), active: Schema.Int });

export type NavigationHistory = typeof NavigationHistory.Type;

export const WaitingQuery = Schema.Record(Schema.String, Schema.String);

export type WaitingQuery = typeof WaitingQuery.Type;

export interface WindowGuards {
  navigate(url: string): Effect.Effect<boolean>;
  openWindow(url: string): Effect.Effect<void>;
  readonly close: Effect.Effect<boolean>;
}

export const ContextMenuParams = Schema.Struct({
  isEditable: Schema.Boolean,
  selectionText: Schema.String,
  misspelledWord: Schema.String,
  dictionarySuggestions: Schema.Array(Schema.String),
  editFlags: Schema.Struct({
    canCut: Schema.Boolean,
    canCopy: Schema.Boolean,
    canPaste: Schema.Boolean,
    canSelectAll: Schema.Boolean,
  }),
});

export type ContextMenuParams = typeof ContextMenuParams.Type;

export const ContextAction = Schema.Union([
  Schema.TaggedStruct('Replace', { word: Schema.String }),
  Schema.TaggedStruct('Learn', { word: Schema.String }),
  Schema.TaggedStruct('LookUp', {}),
]);

export type ContextAction = typeof ContextAction.Type;

export type ContextMenuEntry =
  | { kind: 'separator' }
  | { kind: 'role'; role: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { kind: 'action'; label: string; action: ContextAction }
  | { kind: 'note'; label: string };

export const SUGGESTION_LIMIT = 5;

export const LOOK_UP_LENGTH = 24;
