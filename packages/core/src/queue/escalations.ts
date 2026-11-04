import { isTaskSettled } from '../domain/stages.ts';
import type { TaskEscalation } from '../domain/types.ts';
import type { TeamFeedSnapshot, TeamFeedTask } from '../remote/teams.ts';

export interface TeamEscalation {
  entry: TeamFeedTask;
  escalation: TaskEscalation;
}

const NO_TASKS: ReadonlySet<string> = new Set();

function resolveEscalationKey(entry: TeamFeedTask) {
  return `${entry.instanceId} ${entry.task.id}`;
}

export function resolveTeamEscalationTag(escalation: TeamEscalation) {
  return `escalation:${resolveEscalationKey(escalation.entry)}:${escalation.escalation.at}`;
}

export function listTeamEscalations(
  feed: TeamFeedSnapshot,
  listed: ReadonlySet<string> = NO_TASKS
): TeamEscalation[] {
  const seen = new Set<string>();
  return feed.tasks
    .flatMap((entry) => {
      const escalation = entry.task.escalation;
      const key = resolveEscalationKey(entry);
      if (!escalation || isTaskSettled(entry.task) || listed.has(entry.task.id) || seen.has(key)) return [];
      seen.add(key);
      return [{ entry, escalation }];
    })
    .sort((left, right) => left.escalation.at - right.escalation.at);
}
