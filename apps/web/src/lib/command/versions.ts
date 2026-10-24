import type { ProgramId, VersionsSnapshot } from '@shinsa/core';
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
    disabled: busy,
    run: () => void requestUpdate(program),
  };
}

export function listVersionSections(
  snapshot: VersionsSnapshot | null,
  updating: ProgramId[]
): CommandSection[] {
  const programs: ProgramId[] = ['claude', 'codex'];
  return [
    {
      id: 'global.versions',
      heading: 'Versions',
      rank: RANK.global + 6,
      commands: programs
        .filter((program) => isOffered(snapshot, program))
        .map((program) => createUpdateCommand(snapshot, program, updating)),
    },
  ];
}
