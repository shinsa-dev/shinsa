import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { describePullRequestChanges, describePullRequestRemarks } from './activity.ts';
import type { ShinsaState } from './project.ts';
import { recordRoundPullRequest } from './rounds.ts';
import { record, updateTask } from './write.ts';

type PullRequestEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'pull_request.opened'
      | 'pull_request.updated'
      | 'pull_request.push_requested'
      | 'pull_request.pushed'
      | 'pull_request.head_moved'
      | 'pull_request.watched'
      | 'pull_request.read_failed'
      | 'pull_request.read_failures_cleared';
  }
>;

function applyPullRequestOpened(state: ShinsaState, event: EventOf<'pull_request.opened'>) {
  updateTask(state, event.taskId, event.at, { pullRequest: event.pullRequest });
  recordRoundPullRequest(state, event.taskId, event.at);
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'pull_request',
    text: `Opened pull request #${event.pullRequest.number}`,
  });
}

function applyPullRequestHeadMoved(state: ShinsaState, event: EventOf<'pull_request.head_moved'>) {
  updateTask(state, event.taskId, event.at, { pushedSha: event.sha });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'pull_request',
    text: `The branch moved to ${event.sha.slice(0, 7)}, a commit Shinsa did not push`,
  });
}

function applyPullRequestWatched(state: ShinsaState, event: EventOf<'pull_request.watched'>) {
  updateTask(state, event.taskId, event.at, { pullRequestWatch: event.watch });
  if (event.changes.length === 0) return;
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'pull_request',
    text: describePullRequestChanges(event.changes),
    detail: describePullRequestRemarks(event.changes),
  });
}

export function applyPullRequestEvent(state: ShinsaState, event: PullRequestEvent) {
  switch (event.type) {
    case 'pull_request.opened':
      applyPullRequestOpened(state, event);
      return;
    case 'pull_request.updated':
      updateTask(state, event.taskId, event.at, { pullRequest: event.pullRequest });
      recordRoundPullRequest(state, event.taskId, event.at);
      return;
    case 'pull_request.push_requested':
      updateTask(state, event.taskId, event.at, { pushPending: true });
      return;
    case 'pull_request.pushed':
      updateTask(state, event.taskId, event.at, {
        pushedSha: event.sha,
        pushedFrom: state.tasks[event.taskId]?.pullRequest?.headSha ?? null,
        pushPending: false,
      });
      return;
    case 'pull_request.head_moved':
      applyPullRequestHeadMoved(state, event);
      return;
    case 'pull_request.watched':
      applyPullRequestWatched(state, event);
      return;
    case 'pull_request.read_failed':
      updateTask(state, event.taskId, event.at, { pullRequestReadFailures: event.failures });
      return;
    case 'pull_request.read_failures_cleared':
      updateTask(state, event.taskId, event.at, { pullRequestReadFailures: 0 });
      return;
  }
}
