export type ProgramId = 'claude' | 'codex';

export type ProgramVersionStatus = 'current' | 'update_available' | 'outdated' | 'not_installed' | 'unknown';

export interface ProgramVersion {
  id: ProgramId;
  label: string;
  path: string | null;
  version: string | null;
  latest: string | null;
  minimum: string;
  status: ProgramVersionStatus;
  updater: string | null;
  override: string | null;
  updating: boolean;
}

export interface SdkVersion {
  name: string;
  version: string;
  latest: string | null;
  claudeCodeVersion: string;
}

export interface VersionsSnapshot {
  programs: ProgramVersion[];
  sdk: SdkVersion;
  latestCheckedAt: number | null;
}

export interface UpdateOutcome {
  ok: boolean;
  message: string;
  versions: VersionsSnapshot;
}

export type UpdateStreamLine = { type: 'output'; line: string } | ({ type: 'done' } & UpdateOutcome);
