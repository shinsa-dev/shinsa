import { type ChatEntry, type Run, type RunPurpose, splitHouseRules, type Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { resolveLastHandover } from '@/lib/chat/timeline.ts';
import { readList } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';

export interface RoleMark {
  name: string;
  icon: IconName;
}

export const RUN_ROLE: Record<Run['role'], RoleMark> = {
  agent: { name: 'Agent', icon: 'IconAgent' },
  planner: { name: 'Planner', icon: 'IconMap' },
  builder: { name: 'Builder', icon: 'IconHammer' },
  reviewer: { name: 'Reviewer', icon: 'IconShieldCheck' },
  answerer: { name: 'Answerer', icon: 'IconBubbleText' },
  investigator: { name: 'Investigator', icon: 'IconMagnifyingGlass' },
  researcher: { name: 'Researcher', icon: 'IconBook' },
};

const FIX_FOCUS: { prefix: string; live: string; done: string }[] = [
  { prefix: 'The checks failed', live: 'Fixing the failing checks', done: 'Fixed the failing checks' },
  { prefix: 'The agent review found', live: 'Fixing the review findings', done: 'Fixed the review findings' },
  { prefix: 'The human looked at the work', live: 'Making your changes', done: 'Made your changes' },
  { prefix: 'Pull request #', live: 'Fixing the pull request', done: 'Fixed the pull request' },
  { prefix: 'GitButler left', live: 'Resolving conflicts', done: 'Resolved conflicts' },
  { prefix: 'Your pull request conflicted', live: 'Resolving conflicts', done: 'Resolved conflicts' },
];

function resolvePlanHeadline(done: boolean, task: Task, entries: ChatEntry[]) {
  if (!done) return 'Planning the work';
  const proposed = readList(resolveLastHandover(entries, 'propose_plan'), 'phases').length;
  const phases = proposed || (task.plan?.document?.phases.length ?? 0);
  return phases > 0 ? `Planned ${formatCount(phases, 'phase', 'phases')}` : 'Planned the work';
}

function resolveBuildHeadline(done: boolean, run: Run, task: Task) {
  const phases = task.plan?.document?.phases ?? [];
  const index = run.phaseIndex ?? null;
  const phase = index === null ? undefined : phases[index];
  if (index === null || !phase) return done ? 'Built the change' : 'Building the change';
  return `Phase ${index + 1} of ${phases.length}: ${phase.title}`;
}

function resolveReviewerHeadline(done: boolean, entries: ChatEntry[]) {
  if (!done) return 'Reviewing the change';
  const report = resolveLastHandover(entries, 'report_review');
  if (!report) return 'Reviewed the change';
  const findings = readList(report, 'findings');
  if (findings.length === 0) return 'Reviewed the change, no findings';
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const count = formatCount(findings.length, 'finding', 'findings');
  return blocking > 0
    ? `Reviewed the change, ${count} (${blocking} blocking)`
    : `Reviewed the change, ${count}`;
}

function resolveInstruction(run: Run) {
  const prompt = run.rolePrompt ?? run.prompt ?? '';
  return splitHouseRules(prompt)?.instruction ?? prompt;
}

function resolveFixHeadline(done: boolean, run: Run) {
  const instruction = resolveInstruction(run);
  const focus = FIX_FOCUS.find((candidate) => instruction.startsWith(candidate.prefix));
  if (focus) return done ? focus.done : focus.live;
  return done ? 'Fixed the change' : 'Fixing the change';
}

function resolveAgentHeadline(
  purpose: RunPurpose,
  done: boolean,
  run: Run,
  task: Task,
  entries: ChatEntry[]
) {
  switch (purpose) {
    case 'plan':
      return resolvePlanHeadline(done, task, entries);
    case 'build':
      return resolveBuildHeadline(done, run, task);
    case 'fix':
      return resolveFixHeadline(done, run);
    case 'operate':
      return done ? 'Reported the outcome' : 'Running the operation';
  }
}

export function resolveRunHeadline(run: Run, task: Task, entries: ChatEntry[]) {
  const done = run.endedAt !== null && run.outcome === 'completed';
  switch (run.role) {
    case 'agent':
      return resolveAgentHeadline(run.purpose ?? 'build', done, run, task, entries);
    case 'planner':
      return done ? 'Planned the work' : 'Planning the work';
    case 'builder':
      return done ? 'Built the change' : 'Building the change';
    case 'reviewer':
      return resolveReviewerHeadline(done, entries);
    case 'answerer':
      return done ? 'Answered your question' : 'Answering your question';
    case 'investigator':
      return done ? 'Reported the diagnosis' : 'Investigating';
    case 'researcher':
      return done ? 'Wrote the report' : 'Researching';
  }
}
