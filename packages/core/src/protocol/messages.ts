import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/index.ts';
import type { RemoteSnapshot } from '../remote/status.ts';
import type { TeamFeedSnapshot } from '../remote/teams.ts';
import type { AccountsSnapshot } from './accounts.ts';
import type { EngineInfo } from './engine.ts';
import type { StatePatch } from './patch.ts';
import type { WireState } from './runs.ts';
import type { TerminalsSnapshot } from './terminals.ts';

export const SURFACES = ['desktop', 'browser'] as const;

export type Surface = (typeof SURFACES)[number];

export type ClientMessage =
  | { type: 'hello'; surface: Surface }
  | { type: 'command'; id: string; command: UserCommand }
  | { type: 'state.sync' }
  | { type: 'transcript.subscribe'; runId: string; from: number }
  | { type: 'transcript.unsubscribe'; runId: string };

export type ServerMessage =
  | { type: 'state'; state: WireState }
  | { type: 'state.patch'; patch: StatePatch }
  | { type: 'ack'; id: string; error: { code: string; message: string } | null }
  | { type: 'transcript'; runId: string; entries: ChatEntry[]; start: number }
  | { type: 'accounts'; accounts: AccountsSnapshot }
  | { type: 'surfaces'; desktop: boolean }
  | { type: 'engine'; engine: EngineInfo }
  | { type: 'terminals'; terminals: TerminalsSnapshot }
  | { type: 'remote'; remote: RemoteSnapshot }
  | { type: 'teams'; teams: TeamFeedSnapshot };

export function isSurface(value: unknown): value is Surface {
  return SURFACES.some((surface) => surface === value);
}

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
