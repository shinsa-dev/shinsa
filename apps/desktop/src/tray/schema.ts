import { Predicate, Schema, SchemaGetter } from 'effect';

export const TRAY_LABEL = {
  open: 'Open Shinsa',
  quit: 'Quit Shinsa',
  quitHint: 'The engine and your agents keep running',
  decisions: 'Needs you',
  working: 'Working',
  updating: 'Moves to the new version once agents hand over',
} as const;

export const TRAY_TASK_LIMIT = 5;

const TRAY_TITLE_MAX = 48;

const TRAY_READ_ONLY = 'The menu bar item reads the queue and never writes one';

export const TrayTask = Schema.Struct({ path: Schema.String, title: Schema.String, detail: Schema.String });

export type TrayTask = typeof TrayTask.Type;

const QueueEntry = Schema.Struct({
  taskId: Schema.NonEmptyString,
  handle: Schema.optionalKey(Schema.Unknown),
  title: Schema.String,
  label: Schema.String,
}).pipe(
  Schema.decodeTo(TrayTask, {
    decode: SchemaGetter.transform(({ taskId, handle, title, label }) => {
      const shown = Predicate.isString(handle) && handle !== '' ? handle : null;
      const flat = title.replace(/\s+/g, ' ').trim();
      const detail = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
      return {
        path: `/tasks/${encodeURIComponent(shown ?? taskId)}`,
        title: flat.length <= TRAY_TITLE_MAX ? flat : `${flat.slice(0, TRAY_TITLE_MAX - 1).trimEnd()}…`,
        detail: shown ? `${detail} · ${shown}` : detail,
      };
    }),
    encode: SchemaGetter.forbidden(() => TRAY_READ_ONLY),
  })
);

const SkippedEntry = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Null, {
    decode: SchemaGetter.transform(() => null),
    encode: SchemaGetter.passthroughSupertype(),
  })
);

const TrayTasks = Schema.Array(Schema.Union([QueueEntry, SkippedEntry])).pipe(
  Schema.decodeTo(Schema.Array(TrayTask), {
    decode: SchemaGetter.transform((entries) => entries.filter(Predicate.isNotNull)),
    encode: SchemaGetter.passthroughSupertype(),
  })
);

export const TrayQueue = Schema.Struct({ decisions: TrayTasks, working: TrayTasks });

export type TrayQueue = typeof TrayQueue.Type;

export type TrayAction = 'open' | 'quit';

export type TrayItem =
  | { kind: 'status'; label: string }
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | { kind: 'task'; path: string; label: string; sublabel: string }
  | { kind: 'action'; action: TrayAction; label: string; sublabel?: string };
