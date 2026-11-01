import {
  createState,
  isTaskSettled,
  NO_TEAM_FEED,
  type RemoteTeam,
  type ShareMessage,
  type ShinsaState,
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  type TeamFeedTask,
  type TeamListView,
  type TeamViewTarget,
} from '@shinsa/core';
import { waitFor } from '@/lib/share/live.ts';
import { createSignal } from '@/lib/signal.ts';
import {
  openTeamChannel,
  TEAM_MACHINE_OFFLINE,
  type TeamChannelHandlers,
  type TeamChannelTarget,
} from './channel.ts';
import type { StoredTeamKey } from './join.ts';

const FEED_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const MACHINE_RANK: Record<TeamFeedMachine['status'], number> = {
  live: 0,
  connecting: 1,
  offline: 2,
  refused: 3,
};

function resolveMachineKey(machine: { teamId: string; instanceId: string }) {
  return `${machine.teamId} ${machine.instanceId}`;
}

function resolveTaskKey(task: TeamFeedTask) {
  return `${resolveMachineKey(task)} ${task.task.id}`;
}

export function mergeTeamFeeds(feeds: readonly TeamFeedSnapshot[]): TeamFeedSnapshot {
  const machines = new Map<string, TeamFeedMachine>();
  const tasks = new Map<string, TeamFeedTask>();
  for (const feed of feeds) {
    for (const machine of feed.machines) {
      const key = resolveMachineKey(machine);
      const known = machines.get(key);
      if (!known || MACHINE_RANK[machine.status] < MACHINE_RANK[known.status]) machines.set(key, machine);
    }
    for (const task of feed.tasks) {
      const key = resolveTaskKey(task);
      const known = tasks.get(key);
      if (!known || known.task.updatedAt < task.task.updatedAt) tasks.set(key, task);
    }
  }
  if (machines.size === 0 && tasks.size === 0) return NO_TEAM_FEED;
  return { machines: [...machines.values()], tasks: [...tasks.values()] };
}

export function listTeamFeedTasks(
  feed: TeamFeedSnapshot,
  teamId: string,
  reachable: ReadonlySet<string>
): TeamFeedTask[] {
  return feed.tasks
    .filter((task) => task.teamId === teamId && !reachable.has(task.instanceId))
    .sort(
      (left, right) =>
        Number(isTaskSettled(left.task)) - Number(isTaskSettled(right.task)) ||
        right.task.updatedAt - left.task.updatedAt
    );
}

export function listOpenTeamFeedTasks(tasks: readonly TeamFeedTask[]) {
  return tasks.filter((task) => !isTaskSettled(task.task));
}

export function resolveTeamTaskState(entry: TeamFeedTask): ShinsaState {
  const state = createState();
  return {
    ...state,
    tasks: { [entry.task.id]: entry.task },
    gates: Object.fromEntries(entry.gates.map((gate) => [gate.id, gate])),
    projects: entry.project ? { [entry.project.id]: entry.project } : {},
  };
}

export function matchesTeamTaskSearch(entry: TeamFeedTask, search: string) {
  const words = search.trim().toLowerCase();
  if (!words) return true;
  return [entry.task.title, entry.task.handle ?? '', entry.owner ?? '', entry.machine ?? ''].some((text) =>
    text.toLowerCase().includes(words)
  );
}

export function resolveTeamTaskPath(target: TeamViewTarget) {
  return `/teams/${[target.teamId, target.instanceId, target.taskId].map(encodeURIComponent).join('/')}`;
}

export function resolveTeamTaskTarget(task: TeamFeedTask): TeamViewTarget {
  return { teamId: task.teamId, instanceId: task.instanceId, taskId: task.task.id };
}

export function describeTeamTaskOwner(task: Pick<TeamFeedTask, 'owner' | 'machine'>) {
  if (task.owner) return `@${task.owner}`;
  return task.machine ?? 'A teammate';
}

export interface TeamFeedSource {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => TeamFeedSnapshot;
}

export interface HostedTeamFeedsOptions {
  listTeams: () => Promise<RemoteTeam[]>;
  selectTeamKey: (teamId: string) => Promise<StoredTeamKey | null>;
  openChannel?: (target: TeamChannelTarget, handlers: TeamChannelHandlers) => () => void;
  wait?: (ms: number, run: () => void) => () => void;
}

interface HostedFeed {
  target: TeamChannelTarget;
  machine: TeamFeedMachine;
  tasks: TeamFeedTask[];
  attempt: number;
  stop: (() => void) | null;
}

export class HostedTeamFeeds implements TeamFeedSource {
  readonly #options: HostedTeamFeedsOptions;
  readonly #signal = createSignal();
  #feeds: HostedFeed[] = [];
  #snapshot: TeamFeedSnapshot = NO_TEAM_FEED;
  #started = false;

  constructor(options: HostedTeamFeedsOptions) {
    this.#options = options;
  }

  subscribe = (listener: () => void) => this.#signal.subscribe(listener);

  snapshot = () => this.#snapshot;

  async start() {
    this.#started = true;
    let teams: RemoteTeam[];
    try {
      teams = await this.#options.listTeams();
    } catch {
      return;
    }
    if (!this.#started) return;
    for (const team of teams) {
      const stored = await this.#options.selectTeamKey(team.id);
      if (!(stored && this.#started)) continue;
      for (const machine of team.machines) {
        const feed: HostedFeed = {
          target: { teamId: team.id, instanceId: machine.id, key: stored.key, view: { kind: 'list' } },
          machine: {
            teamId: team.id,
            instanceId: machine.id,
            name: machine.name,
            userId: machine.userId,
            status: machine.online ? 'connecting' : 'offline',
            reason: machine.online ? null : TEAM_MACHINE_OFFLINE,
          },
          tasks: [],
          attempt: 0,
          stop: null,
        };
        this.#feeds.push(feed);
        if (machine.online) this.#connect(feed);
      }
    }
    this.#publish();
  }

  stop() {
    this.#started = false;
    for (const feed of this.#feeds) feed.stop?.();
    this.#feeds = [];
    this.#snapshot = NO_TEAM_FEED;
  }

  #publish() {
    this.#snapshot = {
      machines: this.#feeds.map((feed) => feed.machine),
      tasks: this.#feeds.flatMap((feed) => feed.tasks),
    };
    this.#signal.publish();
  }

  #mark(feed: HostedFeed, status: TeamFeedMachine['status'], reason: string | null) {
    feed.machine = { ...feed.machine, status, reason };
  }

  #receive(feed: HostedFeed, message: ShareMessage) {
    if (message.t !== 'view') return;
    const view = JSON.parse(message.data) as TeamListView;
    feed.tasks = view.tasks.map((task) => ({
      ...task,
      teamId: feed.target.teamId,
      instanceId: feed.target.instanceId,
    }));
    feed.attempt = 0;
    this.#mark(feed, 'live', null);
    this.#publish();
  }

  #connect(feed: HostedFeed) {
    const open = this.#options.openChannel ?? openTeamChannel;
    const wait = this.#options.wait ?? waitFor;
    feed.stop = open(feed.target, {
      onMessage: (message) => {
        if (this.#started) this.#receive(feed, message);
      },
      onEnd: (end) => {
        feed.stop = null;
        if (!this.#started) return;
        feed.tasks = [];
        this.#mark(feed, end.gone ? 'refused' : 'offline', end.reason);
        this.#publish();
        if (end.gone) return;
        const delay = FEED_RETRY_MS[Math.min(feed.attempt, FEED_RETRY_MS.length - 1)] as number;
        feed.attempt += 1;
        const cancel = wait(delay, () => {
          if (this.#started && feed.stop === cancel) this.#connect(feed);
        });
        feed.stop = cancel;
      },
    });
  }
}
