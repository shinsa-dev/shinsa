import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/index.ts';
import type { ShinsaState } from '../state/project.ts';
import type { AccountsSnapshot } from './accounts.ts';

export const SURFACES = ['desktop', 'browser'] as const;

export type Surface = (typeof SURFACES)[number];

export type ClientMessage =
  | { type: 'hello'; surface: Surface }
  | { type: 'command'; id: string; command: UserCommand }
  | { type: 'transcript.subscribe'; runId: string }
  | { type: 'transcript.unsubscribe'; runId: string };

export type ServerMessage =
  | { type: 'state'; state: ShinsaState }
  | { type: 'ack'; id: string; error: { code: string; message: string } | null }
  | { type: 'transcript'; runId: string; entries: ChatEntry[]; reset: boolean }
  | { type: 'accounts'; accounts: AccountsSnapshot }
  | { type: 'surfaces'; desktop: boolean };

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
