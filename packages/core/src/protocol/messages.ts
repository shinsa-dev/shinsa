import { Option, Schema } from 'effect';
import type { ChatEntry } from '../chat/protocol.ts';
import type { MachineResources } from '../remote/resources.ts';
import type { RemoteSnapshot } from '../remote/status.ts';
import type { TeamFeedSnapshot } from '../remote/teams.ts';
import type { AccountsSnapshot } from './accounts.ts';
import type { StatePatch } from './patch.ts';
import type { WireState } from './runs.ts';
import {
  ClientMessage,
  type EngineInfo,
  type ParsedClientMessage,
  type Surface,
  SurfaceName,
} from './schema.ts';
import type { TaskDetail } from './summaries.ts';
import type { TerminalsSnapshot } from './terminals.ts';

export const isSurface = Schema.is(SurfaceName);

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
