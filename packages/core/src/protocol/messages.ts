import { Option, Schema } from 'effect';
import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/index.ts';
import { IdText, RunId, TaskId, type Unbranded } from '../domain/ids.ts';
import { Salvaged } from '../domain/salvage.ts';
import type { MachineResources } from '../remote/resources.ts';
import type { RemoteSnapshot } from '../remote/status.ts';
import type { TeamFeedSnapshot } from '../remote/teams.ts';
import type { AccountsSnapshot } from './accounts.ts';
import type { EngineInfo } from './engine.ts';
import type { StatePatch } from './patch.ts';
import type { WireState } from './runs.ts';
import type { TaskDetail } from './summaries.ts';
import type { TerminalsSnapshot } from './terminals.ts';

export const SURFACES = ['desktop', 'browser'] as const;

const SurfaceName = Schema.Literals(SURFACES);

export type Surface = typeof SurfaceName.Type;

export const isSurface = Schema.is(SurfaceName);

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

const decodeClientMessage = Schema.decodeUnknownOption(Schema.fromJsonString(ClientMessage));

export function parseClientMessage(text: string): ParsedClientMessage | null {
  return Option.getOrNull(decodeClientMessage(text));
}

export type ServerMessage =
  | { type: 'state'; state: WireState }
  | { type: 'state.patch'; patch: StatePatch }
  | { type: 'task.detail'; detail: TaskDetail }
  | { type: 'ack'; id: string; error: { code: string; message: string } | null }
  | { type: 'transcript'; runId: string; entries: ChatEntry[]; start: number }
  | { type: 'accounts'; accounts: AccountsSnapshot }
  | { type: 'surfaces'; desktop: boolean }
  | { type: 'engine'; engine: EngineInfo }
  | { type: 'terminals'; terminals: TerminalsSnapshot }
  | { type: 'resources'; resources: MachineResources }
  | { type: 'remote'; remote: RemoteSnapshot }
  | { type: 'teams'; teams: TeamFeedSnapshot };

export function isQuietSurface(surface: Surface, desktopConnected: boolean) {
  return desktopConnected && surface !== 'desktop';
}

export interface DiffFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  risk: 'high' | 'normal' | 'low';
  riskReason: string | null;
  binary: boolean;
  patch: string;
  patchOmitted?: boolean;
}

export interface TaskDiff {
  base: string;
  head: string;
  files: DiffFile[];
}

export interface RepoCandidate {
  path: string;
  name: string;
  defaultBranch: string;
  remote: string | null;
}
