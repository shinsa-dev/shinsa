import type {
  ExtensionsSnapshot,
  SearchLine,
  ServiceDefinition,
  StoredAttachment,
  TerminalForeground,
  TerminalInfo,
  TerminalsSnapshot,
  UpdateStreamLine,
} from '@shinsa/core';
import { Duration, Predicate, Schema } from 'effect';

export class WorktreeNotOpened extends Schema.TaggedError<
  WorktreeNotOpened,
  { readonly brand: unique symbol }
>()('WorktreeNotOpened', { message: Schema.String }) {}

export const LogProblem = Schema.Struct({
  seq: Schema.Number,
  type: Schema.String,
  kind: Schema.Literals(['unreadable', 'unappliable']),
  error: Schema.String,
});

export type LogProblem = typeof LogProblem.Type;

export const ServerHealth = Schema.Struct({
  ok: Schema.Boolean,
  seq: Schema.Number,
  problems: Schema.Array(LogProblem),
  version: Schema.optionalKey(Schema.String),
  protocol: Schema.optionalKey(Schema.Number),
  busy: Schema.optionalKey(Schema.Boolean),
  working: Schema.optionalKey(Schema.Number),
  restart: Schema.optionalKey(Schema.NullOr(Schema.Literal('idle'))),
  restartBy: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  dataDir: Schema.optionalKey(Schema.String),
});

export type ServerHealth = typeof ServerHealth.Type;

export const StoredAttachmentAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is StoredAttachment => Predicate.isObject(value))
);

export const FILE_UNREADABLE_MESSAGE = 'Couldn’t read the file.';

export class FileUnreadable extends Schema.TaggedError<FileUnreadable, { readonly brand: unique symbol }>()(
  'FileUnreadable',
  { message: Schema.String }
) {}

export const InstallAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is { readonly terminal: TerminalInfo } => Predicate.isObject(value))
);

export const PRIVACY_NOT_OPENED_MESSAGE =
  'System Settings did not open. Open it yourself and go to Privacy & Security → Full Disk Access.';

export class PrivacyNotOpened extends Schema.TaggedError<
  PrivacyNotOpened,
  { readonly brand: unique symbol }
>()('PrivacyNotOpened', { message: Schema.String }) {}

export class CommandFailed extends Schema.TaggedError<CommandFailed, { readonly brand: unique symbol }>()(
  'CommandFailed',
  { message: Schema.String }
) {}

export class UsageRecheckFailed extends Schema.TaggedError<
  UsageRecheckFailed,
  { readonly brand: unique symbol }
>()('UsageRecheckFailed', { message: Schema.String }) {}

export class PlacementUnanswered extends Schema.TaggedError<
  PlacementUnanswered,
  { readonly brand: unique symbol }
>()('PlacementUnanswered', {}) {}

export const TerminalOpenedAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot & { readonly terminal: TerminalInfo } =>
    Predicate.isObject(value)
  )
);

export const ServiceAddedAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot & { readonly service: ServiceDefinition } =>
    Predicate.isObject(value)
  )
);

export const ServicesAddedAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot & { readonly added: ServiceDefinition[] } =>
    Predicate.isObject(value)
  )
);

export const ServiceStoppedAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot => Predicate.isObject(value))
);

export const ForegroundAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalForeground => Predicate.isObject(value))
);

export const NO_TERMINAL_PLACE_MESSAGE = 'This task has no project folder to open a terminal in.';

export class NoTerminalPlace extends Schema.TaggedError<NoTerminalPlace, { readonly brand: unique symbol }>()(
  'NoTerminalPlace',
  { message: Schema.String }
) {}

export const UpdateLine = Schema.Unknown.pipe(
  Schema.refine((value): value is UpdateStreamLine => Predicate.isObject(value))
);

export const SearchLineAnswer = Schema.Unknown.pipe(
  Schema.refine((value): value is SearchLine => Predicate.isObject(value))
);

export const UPDATE_UNFINISHED_MESSAGE = 'The update ended without saying how it went.';

export class UpdateUnfinished extends Schema.TaggedError<
  UpdateUnfinished,
  { readonly brand: unique symbol }
>()('UpdateUnfinished', { message: Schema.String }) {}

export const SignInAnswer = Schema.Unknown.pipe(
  Schema.refine(
    (value): value is { readonly authorizationUrl: string | null; readonly snapshot: ExtensionsSnapshot } =>
      Predicate.isObject(value)
  )
);

export const CodeRead = Schema.Literals(['refs', 'paths', 'tree', 'blob', 'diff']);

export const APP_UPDATES_POLL = Duration.seconds(3);
