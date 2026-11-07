import { type Effect, Schema } from 'effect';
import type { CdpCommandFailed, CdpEvaluateFailed, CdpPage } from '../../kit/chromium/index.ts';

export const LongTasks = Schema.Struct({ count: Schema.Number, max: Schema.Number, total: Schema.Number });

export const Navigation = Schema.Struct({ ms: Schema.Number, found: Schema.Boolean, long: LongTasks });

export const ChatScroll = Schema.NullOr(
  Schema.Struct({
    p95: Schema.Number,
    max: Schema.Number,
    over16: Schema.Number,
    vsyncP95: Schema.Number,
    vsyncMax: Schema.Number,
    dropped: Schema.Number,
    long: LongTasks,
  })
);

export const ListScroll = Schema.NullOr(
  Schema.Struct({ p95: Schema.Number, max: Schema.Number, long: LongTasks })
);

export const HeldPlace = Schema.NullOr(Schema.Struct({ jumps: Schema.Number, worst: Schema.Number }));

export const Inputs = Schema.Array(Schema.Struct({ delay: Schema.Number, paint: Schema.Number }));

export const PushCost = Schema.Struct({
  state: Schema.Number,
  stateMax: Schema.Number,
  transcript: Schema.Number,
  transcriptMax: Schema.Number,
});

export const Measurements = Schema.Record(Schema.String, Schema.Number);
export type Measurements = typeof Measurements.Type;

export type Scenario = (
  page: CdpPage,
  taskId: string
) => Effect.Effect<Measurements, CdpCommandFailed | CdpEvaluateFailed>;

const CallFrame = Schema.Struct({
  functionName: Schema.String,
  url: Schema.String,
  lineNumber: Schema.Number,
});

const ProfileNode = Schema.Struct({
  id: Schema.Number,
  callFrame: CallFrame,
  children: Schema.optionalKey(Schema.Array(Schema.Number)),
});

export const Profile = Schema.Struct({
  nodes: Schema.Array(ProfileNode),
  samples: Schema.Array(Schema.Number),
  timeDeltas: Schema.Array(Schema.Number),
});
export type Profile = typeof Profile.Type;

export const ProfileReply = Schema.Struct({ profile: Profile });

const TraceEvent = Schema.Struct({
  name: Schema.String,
  ph: Schema.String,
  dur: Schema.optionalKey(Schema.Number),
});

export const TraceChunk = Schema.Struct({ value: Schema.Array(TraceEvent) });

export const MAIN_EVENTS: ReadonlySet<string> = new Set([
  'FunctionCall',
  'EvaluateScript',
  'TimerFire',
  'RunMicrotasks',
  'UpdateLayoutTree',
  'Layout',
  'PrePaint',
  'Paint',
  'Layerize',
  'Commit',
  'MinorGC',
  'MajorGC',
  'ParseHTML',
  'HitTest',
  'IntersectionObserverController::computeIntersections',
  'ResizeObserverController::BroadcastObservations',
]);

export const CONTENT_WINDOW = { width: 1280, height: 900 };

export const RUN_SECTION = 'section[id^="run-"]';

export const WAIT_FOR_STATE = `new Promise((resolve) => { const check = () => window.__perf?.lastState ? resolve(true) : setTimeout(check, 20); check(); })`;

export const SCROLL_STEP = 'scroll:';

export const NO_MEASUREMENTS: Measurements = {};

export class ScaleDataMissing extends Schema.TaggedError<
  ScaleDataMissing,
  { readonly brand: unique symbol }
>()('ScaleDataMissing', { message: Schema.String }) {}

export const SCALE_USAGE = 'Usage: bun scripts/perf/content-seed.ts <data dir>   (a copy of `bun run seed`)';

export const SCALE_EMPTY = 'The data dir has no tasks to copy: run `bun run seed` into it first.';
