import type { ProgramId, ProgramVersion, SdkVersion, VersionsSnapshot } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

export const VERSIONS_SECTION = 'Versions';

export const VERSIONS_LABEL = {
  refresh: 'Check for updates',
  update: 'Update',
  sdk: 'Claude Agent SDK',
  checking: 'Checking the versions…',
} as const;

interface VersionStatus {
  label: string;
  tone: Tone;
}

export interface VersionRow {
  title: string;
  version: string | null;
  status: VersionStatus | null;
  detail: string;
  canUpdate: boolean;
  updating: boolean;
}

const PROGRAM_LABELS: Record<ProgramId, string> = { claude: 'Claude Code', codex: 'Codex' };

export function resolveProgramLabel(program: ProgramId) {
  return PROGRAM_LABELS[program];
}

function resolveOverrideEnv(program: ProgramId) {
  return program === 'claude' ? 'CLAUDE_EXECUTABLE' : 'CODEX_EXECUTABLE';
}

function resolveProgramStatus(program: ProgramVersion): VersionStatus | null {
  switch (program.status) {
    case 'update_available':
      return { label: 'Update available', tone: 'blue' };
    case 'outdated':
      return { label: 'Update needed', tone: 'orange' };
    case 'not_installed':
      return { label: 'Not installed', tone: 'neutral' };
    case 'unknown':
      return program.override
        ? { label: `Set by ${resolveOverrideEnv(program.id)}`, tone: 'neutral' }
        : { label: 'Couldn’t read the version', tone: 'neutral' };
    case 'current':
      return null;
  }
}

function joinDetail(parts: (string | null)[]) {
  return parts.filter(Boolean).join(' · ');
}

function isUpdatable(program: ProgramVersion) {
  return program.status === 'update_available' || program.status === 'outdated';
}

export function describeProgramRow(program: ProgramVersion, busy = false): VersionRow {
  const updating = program.updating || busy;
  return {
    title: program.label,
    version: program.version,
    status: resolveProgramStatus(program),
    detail: joinDetail([
      program.latest ? `Latest ${program.latest}` : null,
      `Shinsa needs ${program.minimum} or newer`,
    ]),
    canUpdate: isUpdatable(program) && !updating,
    updating,
  };
}

function isSdkBehind(sdk: SdkVersion) {
  return sdk.latest !== null && sdk.latest !== sdk.version;
}

export function describeSdkRow(sdk: SdkVersion): VersionRow {
  return {
    title: VERSIONS_LABEL.sdk,
    version: sdk.version,
    status: isSdkBehind(sdk) ? { label: 'Newer version published', tone: 'neutral' } : null,
    detail: joinDetail([
      sdk.latest ? `Latest ${sdk.latest}` : null,
      `Pairs with Claude Code ${sdk.claudeCodeVersion}`,
    ]),
    canUpdate: false,
    updating: false,
  };
}

export type VersionEntry = { kind: 'program'; program: ProgramVersion } | { kind: 'sdk'; sdk: SdkVersion };

export function listVersionEntries(snapshot: VersionsSnapshot): VersionEntry[] {
  const sdk: VersionEntry = { kind: 'sdk', sdk: snapshot.sdk };
  const programs = snapshot.programs.map((program): VersionEntry => ({ kind: 'program', program }));
  const claude = snapshot.programs.findIndex((program) => program.id === 'claude');
  const after = claude === -1 ? programs.length : claude + 1;
  return [...programs.slice(0, after), sdk, ...programs.slice(after)];
}

export function selectProgram(snapshot: VersionsSnapshot | null, program: ProgramId) {
  return snapshot?.programs.find((entry) => entry.id === program) ?? null;
}

export function describeUpdateHint(program: ProgramVersion | null) {
  if (!program) return undefined;
  if (program.updating) return 'Updating…';
  if (program.version && program.latest && isUpdatable(program))
    return `${program.version} → ${program.latest}`;
  if (program.status === 'current') return 'Up to date';
  return undefined;
}

export function describeUpdating(program: ProgramId) {
  return `Updating ${resolveProgramLabel(program)}`;
}

export function describeUpdater(updater: string | null) {
  return updater ? `Running ${updater}.` : 'Starting the update.';
}
