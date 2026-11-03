import type { ProgramId, VersionsSnapshot } from '@shinsa/core';
import { CHANGELOG_COPY, CHANGELOG_ICON, openChangelog } from '@/lib/changelog.ts';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { requestUpdate } from '@/lib/connection/versions.ts';
import { describeUpdateHint, resolveProgramLabel, selectProgram } from '@/lib/versions.ts';

const PROGRAM_KEYWORDS: Record<ProgramId, string[]> = {
  claude: ['update', 'upgrade', 'version', 'claude', 'cli', 'sdk'],
  codex: ['update', 'upgrade', 'version', 'codex', 'cli', 'openai'],
};

function isOffered(snapshot: VersionsSnapshot | null, program: ProgramId) {
  const found = selectProgram(snapshot, program);
  if (!found) return program === 'claude';
  return found.path !== null && found.override === null;
}

function createUpdateCommand(
  snapshot: VersionsSnapshot | null,
  program: ProgramId,
  updating: ProgramId[]
): Command {
  const found = selectProgram(snapshot, program);
  const busy = updating.includes(program) || found?.updating === true;
  const hint = describeUpdateHint(found && { ...found, updating: busy });
  return {
    kind: 'run',
    id: `versions.update.${program}`,
    label: `Update ${resolveProgramLabel(program)}`,
    ...(hint ? { hint } : {}),
    icon: 'IconArrowDown',
    keywords: PROGRAM_KEYWORDS[program],
    ...(busy ? { disabled: 'Updating…' } : {}),
    run: () => void requestUpdate(program),
  };
}

const CHANGELOG_COMMAND: Command = {
  kind: 'run',
  id: 'versions.changelog',
  label: CHANGELOG_COPY.title,
  hint: CHANGELOG_COPY.rowDetail,
  icon: CHANGELOG_ICON,
  keywords: ['changelog', 'release notes', 'what’s new', 'whats new', 'version', 'changes'],
  run: () => openChangelog(),
};

export function listVersionSections(
  snapshot: VersionsSnapshot | null,
  updating: ProgramId[],
  changelog: boolean
): CommandSection[] {
  const programs: ProgramId[] = ['claude', 'codex'];
  const updates = programs
    .filter((program) => isOffered(snapshot, program))
    .map((program) => createUpdateCommand(snapshot, program, updating));
  return [
    {
      id: 'global.versions',
      heading: 'Versions',
      rank: RANK.global + 6,
      commands: changelog ? [CHANGELOG_COMMAND, ...updates] : updates,
    },
  ];
}
