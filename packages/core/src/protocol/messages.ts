import type { ChatEntry } from '../chat/protocol.ts';
import type { UserCommand } from '../commands/index.ts';
import type { ShinsaState } from '../state/project.ts';
import type { AccountsSnapshot } from './accounts.ts';

export type ClientMessage =
  | { type: 'command'; id: string; command: UserCommand }
  | { type: 'transcript.subscribe'; runId: string }
  | { type: 'transcript.unsubscribe'; runId: string };

export type ServerMessage =
  | { type: 'state'; state: ShinsaState }
  | { type: 'ack'; id: string; error: { code: string; message: string } | null }
  | { type: 'transcript'; runId: string; entries: ChatEntry[]; reset: boolean }
  | { type: 'accounts'; accounts: AccountsSnapshot };

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
