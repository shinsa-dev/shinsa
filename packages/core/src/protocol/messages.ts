import { type Option, Schema } from 'effect';
import { ClientMessage, type ParsedClientMessage, type Surface, SurfaceName } from './schema.ts';

export const isSurface = Schema.is(SurfaceName);

const decodeClientMessage = Schema.decodeUnknownOption(Schema.fromJsonString(ClientMessage));

export function parseClientMessage(text: string): Option.Option<ParsedClientMessage> {
  return decodeClientMessage(text);
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
