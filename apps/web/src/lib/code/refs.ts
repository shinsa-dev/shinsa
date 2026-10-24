import { type TaskRefs, WORKING_REF } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

export interface RefChoice {
  value: string;
  label: string;
  hint: string;
  icon: IconName;
  group: string;
}

export function formatSha(sha: string) {
  return sha.slice(0, 7);
}

function isKnownCommit(refs: TaskRefs, ref: string) {
  return ref === refs.head || ref === refs.base || refs.commits.some((commit) => commit.sha === ref);
}

export function resolveViewRef(param: string | null, refs: TaskRefs) {
  if (param === WORKING_REF && refs.working) return WORKING_REF;
  if (param && param !== WORKING_REF && isKnownCommit(refs, param)) return param;
  return refs.head;
}

export function listRefChoices(refs: TaskRefs): RefChoice[] {
  const choices: RefChoice[] = [
    {
      value: refs.head,
      label: refs.branch ? 'Head of the branch' : `${refs.defaultBranch}`,
      hint: formatSha(refs.head),
      icon: 'IconBranch',
      group: 'Branch',
    },
  ];
  if (refs.working) {
    choices.push({
      value: WORKING_REF,
      label: 'Working copy',
      hint: refs.dirty ? 'Uncommitted edits' : 'No uncommitted edits',
      icon: 'IconPencil',
      group: 'Branch',
    });
  }
  if (refs.base && refs.base !== refs.head) {
    choices.push({
      value: refs.base,
      label: 'Base',
      hint: formatSha(refs.base),
      icon: 'IconBranch',
      group: 'Branch',
    });
  }
  for (const commit of [...refs.commits].reverse()) {
    if (commit.sha === refs.head) continue;
    choices.push({
      value: commit.sha,
      label: commit.subject,
      hint: formatSha(commit.sha),
      icon: 'IconCommits',
      group: 'Commits',
    });
  }
  return choices;
}
