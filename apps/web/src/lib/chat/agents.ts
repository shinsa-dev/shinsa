import { isDelegatedRun, listChildRuns, type Run, type ShinsaState, type Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { listTaskRuns } from '@/lib/chat/runs.ts';
import { formatCount } from '@/lib/format/count.ts';

export interface AgentNode {
  key: string;
  icon: IconName;
  name: string;
  label: string | null;
  detail: string;
  runId: string;
  live: boolean;
  depth: number;
}

interface RoleGroup {
  name: string;
  icon: IconName;
  latest: Run;
  runs: Run[];
}

function groupByRole(runs: Run[]) {
  const groups: RoleGroup[] = [];
  for (const run of runs) {
    const { name, icon } = RUN_ROLE[run.role];
    const group = groups.find((candidate) => candidate.name === name);
    if (group) {
      group.runs.push(run);
      group.latest = run;
    } else groups.push({ name, icon, latest: run, runs: [run] });
  }
  return groups;
}

function describeGroup(runs: Run[]) {
  const count = formatCount(runs.length, 'run', 'runs');
  return runs.some((run) => run.endedAt === null) ? `${count} · working now` : count;
}

function describeDelegated(run: Run) {
  if (run.endedAt === null) return 'Working now';
  if (run.outcome === 'failed') return 'Failed';
  return run.outcome === 'cancelled' ? 'Stopped' : 'Finished';
}

function listDelegated(state: ShinsaState, parent: Run, depth: number): AgentNode[] {
  return listChildRuns(state, parent.id).flatMap((child) => [
    {
      key: child.id,
      icon: RUN_ROLE[child.role].icon,
      name: RUN_ROLE[child.role].name,
      label: child.delegation.title,
      detail: describeDelegated(child),
      runId: child.id,
      live: child.endedAt === null,
      depth,
    },
    ...listDelegated(state, child, depth + 1),
  ]);
}

export function listTaskAgents(state: ShinsaState, task: Task): AgentNode[] {
  const steps = listTaskRuns(state.runs, task.id).filter((run) => !isDelegatedRun(run));
  return groupByRole(steps).flatMap((group) => [
    {
      key: group.name,
      icon: group.icon,
      name: group.name,
      label: null,
      detail: describeGroup(group.runs),
      runId: group.latest.id,
      live: group.runs.some((run) => run.endedAt === null),
      depth: 0,
    },
    ...group.runs.flatMap((run) => listDelegated(state, run, 1)),
  ]);
}

export function describeAgentCount(nodes: AgentNode[]) {
  return formatCount(nodes.length, 'agent', 'agents');
}
