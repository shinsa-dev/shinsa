import { Predicate, Schema } from 'effect';
import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/schema.ts';
import type { Run, Task } from '../domain/index.ts';
import { Salvaged, SalvagedItems } from '../domain/salvage.ts';
import { IdText, RunId, TaskId, type Unbranded } from '../domain/schema.ts';
import type { FixFocus } from '../prompts/focus.ts';
import type { MachineResources } from '../remote/resources.ts';
import type { RemoteSnapshot } from '../remote/status.ts';
import type { TeamFeedSnapshot } from '../remote/teams.ts';
import type { ShinsaState } from '../state/project.ts';
import type { AccountsSnapshot } from './accounts.ts';
import type { StatePatch } from './patch.ts';
import type { TaskDetail } from './summaries.ts';
import type { TerminalsSnapshot } from './terminals.ts';

export const DEVELOPMENT_VERSION = '0.0.0';

export const EngineInfo = Schema.Struct({
  version: Salvaged(Schema.String, () => DEVELOPMENT_VERSION),
  protocol: Schema.Number.check(Schema.makeFilter(Number.isInteger)),
  commands: SalvagedItems(Schema.String),
  features: SalvagedItems(Schema.String),
});

export type EngineInfo = typeof EngineInfo.Type;

export const SURFACES = ['desktop', 'browser'] as const;

export const SurfaceName = Schema.Literals(SURFACES);

export type Surface = typeof SurfaceName.Type;

export const ATTENTION_PLACES = ['here', 'elsewhere', 'nowhere'] as const;

export const AttentionPlace = Schema.Literals(ATTENTION_PLACES);

export type AttentionPlace = typeof AttentionPlace.Type;

const TranscriptIndex = Schema.Number.check(
  Schema.makeFilter(Number.isSafeInteger),
  Schema.isGreaterThanOrEqualTo(0)
);

export const ClientMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('hello'), surface: SurfaceName }),
  Schema.Struct({ type: Schema.Literal('presence'), active: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal('command'), id: IdText, command: Schema.optionalKey(Schema.Unknown) }),
  Schema.Struct({ type: Schema.Literal('state.sync') }),
  Schema.Struct({ type: Schema.Literal('task.detail'), taskId: TaskId }),
  Schema.Struct({
    type: Schema.Literal('transcript.subscribe'),
    runId: RunId,
    from: Salvaged(TranscriptIndex, () => 0),
  }),
  Schema.Struct({ type: Schema.Literal('transcript.unsubscribe'), runId: RunId }),
]);

export type ParsedClientMessage = typeof ClientMessage.Type;

export type WireRun = Omit<Run, 'prompt' | 'rolePrompt' | 'told'> & { fixFocus?: FixFocus };

export type WireTask = Task & { summarized?: true };

export type WireState = Omit<ShinsaState, 'runs' | 'tasks' | 'autopilotModel' | 'autopilotHistory'> & {
  tasks: Record<string, WireTask>;
  runs: Record<string, WireRun>;
};

export const WireState = Schema.Unknown.pipe(
  Schema.refine(
    (value): value is WireState => Predicate.isObject(value) && Predicate.hasProperty(value, 'seq')
  )
);

const StatePatchBody = Schema.Unknown.pipe(
  Schema.refine((value): value is StatePatch => Predicate.isObject(value))
);

const TaskDetailBody = Schema.Unknown.pipe(
  Schema.refine((value): value is TaskDetail => Predicate.isObject(value))
);

const ChatEntryBody = Schema.Unknown.pipe(
  Schema.refine((value): value is ChatEntry => Predicate.isObject(value))
);

const AccountsBody = Schema.Unknown.pipe(
  Schema.refine((value): value is AccountsSnapshot => Predicate.isObject(value))
);

const TerminalsBody = Schema.Unknown.pipe(
  Schema.refine((value): value is TerminalsSnapshot => Predicate.isObject(value))
);

const ResourcesBody = Schema.Unknown.pipe(
  Schema.refine((value): value is MachineResources => Predicate.isObject(value))
);

const RemoteBody = Schema.Unknown.pipe(
  Schema.refine((value): value is RemoteSnapshot => Predicate.isObject(value))
);

const TeamsBody = Schema.Unknown.pipe(
  Schema.refine((value): value is TeamFeedSnapshot => Predicate.isObject(value))
);

export const CommandRefusal = Schema.Struct({ code: Schema.String, message: Schema.String });

export const ServerMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('state'), state: WireState }),
  Schema.Struct({ type: Schema.Literal('state.patch'), patch: StatePatchBody }),
  Schema.Struct({ type: Schema.Literal('task.detail'), detail: TaskDetailBody }),
  Schema.Struct({ type: Schema.Literal('ack'), id: Schema.String, error: Schema.NullOr(CommandRefusal) }),
  Schema.Struct({
    type: Schema.Literal('transcript'),
    runId: Schema.String,
    entries: Schema.Array(ChatEntryBody),
    start: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal('accounts'), accounts: AccountsBody }),
  Schema.Struct({ type: Schema.Literal('surfaces'), desktop: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal('attention'), where: AttentionPlace }),
  Schema.Struct({ type: Schema.Literal('engine'), engine: EngineInfo }),
  Schema.Struct({ type: Schema.Literal('terminals'), terminals: TerminalsBody }),
  Schema.Struct({ type: Schema.Literal('resources'), resources: ResourcesBody }),
  Schema.Struct({ type: Schema.Literal('remote'), remote: RemoteBody }),
  Schema.Struct({ type: Schema.Literal('teams'), teams: TeamsBody }),
]);

export type ServerMessage = typeof ServerMessage.Type;

export type ClientMessage =
  | Unbranded<Exclude<ParsedClientMessage, { type: 'command' }>>
  | { type: 'command'; id: string; command: UserCommand };

export const TERMINAL_LIMITS = {
  terminals: 32,
  name: 60,
  cols: 1000,
  rows: 500,
  command: 4000,
} as const;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));

export const TerminalColors = Schema.Struct({ foreground: HexColor, background: HexColor, cursor: HexColor });

export type TerminalColors = typeof TerminalColors.Type;

const Dimension = Schema.Number.check(Schema.makeFilter(Number.isInteger), Schema.isGreaterThan(0));

const TerminalSize = {
  cols: Dimension.check(Schema.isLessThanOrEqualTo(TERMINAL_LIMITS.cols)),
  rows: Dimension.check(Schema.isLessThanOrEqualTo(TERMINAL_LIMITS.rows)),
};

export const TerminalClientFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal('resize'), ...TerminalSize }),
  Schema.Struct({ type: Schema.Literal('colors'), colors: TerminalColors }),
  Schema.Struct({ type: Schema.Literal('clear') }),
]);

export type TerminalClientFrame = typeof TerminalClientFrame.Type;

export const TerminalServerFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal('reset'), ...TerminalSize }),
  Schema.Struct({ type: Schema.Literal('live') }),
]);

export type TerminalServerFrame = typeof TerminalServerFrame.Type;
