import { Schema } from 'effect';
import type { UserCommand } from '../commands/schema.ts';
import { Salvaged, SalvagedItems } from '../domain/salvage.ts';
import { IdText, RunId, TaskId, type Unbranded } from '../domain/schema.ts';

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

const TranscriptIndex = Schema.Number.check(
  Schema.makeFilter(Number.isSafeInteger),
  Schema.isGreaterThanOrEqualTo(0)
);

export const ClientMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('hello'), surface: SurfaceName }),
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
