import type { EventOf, ShinsaEvent } from '../events/index.ts';
import {
  describeHookFailure,
  describePullRequestChanges,
  describePullRequestRemarks,
  describePushRetry,
} from './activity.ts';
import type { ShinsaState } from './project.ts';
import { recordRoundPullRequest, recordRoundPullRequestsClosed } from './rounds.ts';
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
      | 'pull_request.read_failures_cleared'
      | 'pull_request.push_retrying'
      | 'pull_request.hook_failed'
      | 'pull_request.closed';
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
  updateTask(state, event.taskId, event.at, { pushedSha: event.sha, pushedAt: event.at });
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

function applyPullRequestClosed(state: ShinsaState, event: EventOf<'pull_request.closed'>) {
  const pullRequest = state.tasks[event.taskId]?.pullRequest;
  if (pullRequest?.state === 'open' && event.closed.includes(pullRequest.number)) {
    updateTask(state, event.taskId, event.at, { pullRequest: { ...pullRequest, state: 'closed' } });
  }
  recordRoundPullRequestsClosed(state, event.taskId, event.closed, event.at);
  for (const number of event.closed) {
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'pull_request',
      text: `Closed pull request #${number}`,
    });
  }
  for (const failure of event.failed) {
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'pull_request',
      text: `Could not close pull request #${failure.number}`,
      detail: failure.detail,
    });
  }
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
        pushedAt: event.at,
        pushedFrom: state.tasks[event.taskId]?.pullRequest?.headSha ?? null,
        pushPending: false,
        pushHookFailure: null,
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
    case 'pull_request.push_retrying':
      record(state, event.taskId, event.at, {
        actor: 'shinsa',
        kind: 'pull_request',
        ...describePushRetry(event),
      });
      return;
    case 'pull_request.closed':
      applyPullRequestClosed(state, event);
      return;
    case 'pull_request.hook_failed':
      updateTask(state, event.taskId, event.at, { pushHookFailure: event.failure });
      record(state, event.taskId, event.at, {
        actor: 'shinsa',
        kind: 'pull_request',
        ...describeHookFailure(event.failure),
      });
      return;
  }
}
