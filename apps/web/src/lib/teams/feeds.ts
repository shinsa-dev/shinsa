import {
  createState,
  isTaskSettled,
  isTeamSnapshotExpired,
  NO_TEAM_FEED,
  type RemoteTeam,
  type RemoteUser,
  type ShareMessage,
  type ShinsaState,
  selectTeamSnapshotSigner,
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  type TeamFeedTask,
  type TeamSnapshot,
  type TeamTask,
  type TeamViewTarget,
  type Task,
  TEAM_REFUSALS,
  verifyTeamSnapshot,
} from '@shinsa/core';
import { Clock, Duration, Effect, Option, Schema } from 'effect';
import type { MachineView } from '@/lib/connection/socket.ts';
import { describeMachineName } from '@/lib/remote/setup-steps.ts';
import { type Mention, resolveFirstName, resolveSharedProfile } from '@/lib/remote/users.ts';
import { forkApp, runApp } from '@/lib/runtime/app.ts';
import { createSignal } from '@/lib/signal.ts';
import { resolveTaskPath } from '@/router.ts';
import { openTeamChannel } from './channel.ts';
import { type StoredTeamKey, TeamListViewText } from './schema.ts';
import { selectTeamPerson } from './settings.ts';
import {
  TEAM_MACHINE_OFFLINE,
  type TeamChannelHandlers,
  type TeamChannelTarget,
} from './team-socket/schema.ts';

function waitOnTimer(ms: number, run: () => void) {
  const fiber = forkApp(Effect.delay(Effect.sync(run), Duration.millis(ms)));
  return () => {
    fiber.interruptUnsafe();
  };
}

const FEED_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const FEED_REFUSED_RETRY_MS = [60_000, 120_000, 300_000];

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

function isBetterMachine(machine: TeamFeedMachine, known: TeamFeedMachine) {
  const rank = MACHINE_RANK[machine.status] - MACHINE_RANK[known.status];
  return rank < 0 || (rank === 0 && (machine.updatedAt ?? -1) > (known.updatedAt ?? -1));
}

export function listHeldTeamMachines(feed: TeamFeedSnapshot): ReadonlyMap<string, number> {
  return new Map(
    feed.machines.flatMap((machine) =>
      machine.status !== 'live' && machine.updatedAt !== undefined
        ? [[resolveMachineKey(machine), machine.updatedAt] as const]
        : []
    )
  );
}

export function selectTeamTaskHeldAt(
  held: ReadonlyMap<string, number>,
  entry: Pick<TeamFeedTask, 'teamId' | 'instanceId'>
) {
  return held.get(resolveMachineKey(entry)) ?? null;
}

export function mergeTeamFeeds(feeds: readonly TeamFeedSnapshot[]): TeamFeedSnapshot {
  const machines = new Map<string, TeamFeedMachine>();
  const tasks = new Map<string, TeamFeedTask>();
  for (const feed of feeds) {
    for (const machine of feed.machines) {
      const key = resolveMachineKey(machine);
      const known = machines.get(key);
      if (!known || isBetterMachine(machine, known)) machines.set(key, machine);
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

export function listHeldTaskIds(state: Pick<ShinsaState, 'tasks' | 'teammateTasks'> | null) {
  if (!state?.teammateTasks) return NO_HELD_TASKS;
  return new Set(Object.keys(state.tasks).filter((id) => !state.teammateTasks?.[id]));
}

const NO_HELD_TASKS: ReadonlySet<string> = new Set();

export function listFullMachineIds(machines: readonly Pick<MachineView, 'id' | 'teammate'>[]) {
  return new Set(machines.filter((machine) => !machine.teammate).map((machine) => machine.id));
}

export function listTeamFeedTasks(
  feed: TeamFeedSnapshot,
  teamIds: ReadonlySet<string>,
  reachable: ReadonlySet<string>,
  listed: ReadonlySet<string> = NO_HELD_TASKS
): TeamFeedTask[] {
  const seen = new Set<string>();
  return feed.tasks
    .filter((task) => {
      const key = `${task.instanceId}:${task.task.id}`;
      if (!teamIds.has(task.teamId) || reachable.has(task.instanceId) || listed.has(task.task.id))
        return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        Number(isTaskSettled(left.task)) - Number(isTaskSettled(right.task)) ||
        right.task.updatedAt - left.task.updatedAt
    );
}

export function resolveTeamTaskState(entry: TeamFeedTask): ShinsaState {
  const state = createState();
  return {
    ...state,
    tasks: { [entry.task.id]: entry.task },
    gates: Object.fromEntries(entry.gates.map((gate) => [gate.id, gate])),
    projects: entry.project ? { [entry.project.id]: entry.project } : {},
    repos: entry.repo ? { [entry.repo.id]: entry.repo } : {},
  };
}

export function resolveTeamTaskPath(target: TeamViewTarget) {
  return `/teams/${[target.teamId, target.instanceId, target.taskId].map(encodeURIComponent).join('/')}`;
}

export function resolveFleetTeamTaskPath(
  target: TeamViewTarget,
  task: Task | null,
  machine: Pick<MachineView, 'id' | 'teammate'> | null
) {
  if (!(task && machine?.teammate && machine.id === target.instanceId)) return null;
  return resolveTaskPath(task);
}

export function resolveTeamTaskTarget(task: TeamFeedTask): TeamViewTarget {
  return { teamId: task.teamId, instanceId: task.instanceId, taskId: task.task.id };
}

export function describeTeamTaskOwner(task: Pick<TeamFeedTask, 'owner' | 'machine' | 'ownerProfile'>) {
  if (task.owner) return resolveFirstName(resolveSharedProfile(task.owner, task.ownerProfile));
  return task.machine ?? 'A teammate';
}

export function describeTeamTaskPlace(task: Pick<TeamFeedTask, 'machine'>) {
  return task.machine ? `On ${task.machine}, read-only` : 'Read-only';
}

export interface TeamFeedSource {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => TeamFeedSnapshot;
}

export interface HostedTeamFeedsOptions {
  listTeams: () => Promise<readonly RemoteTeam[]>;
  selectTeamKey: (teamId: string) => Promise<StoredTeamKey | null>;
  openChannel?: (target: TeamChannelTarget, handlers: TeamChannelHandlers) => () => void;
  wait?: (ms: number, run: () => void) => () => void;
  now?: () => number;
}

interface HostedFeed {
  target: TeamChannelTarget;
  machine: TeamFeedMachine;
  signingKey: string | null;
  tasks: TeamTask[];
  updatedAt: number | null;
  attempt: number;
  stop: (() => void) | null;
}

const decodeListView = Schema.decodeUnknownOption(TeamListViewText);

function readNow(options: HostedTeamFeedsOptions) {
  return options.now ? Effect.sync(options.now) : Clock.currentTimeMillis;
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

  start() {
    this.#started = true;
    return runApp(
      Effect.gen({ self: this }, function* () {
        const teams = yield* Effect.option(Effect.tryPromise(() => this.#options.listTeams()));
        if (Option.isNone(teams) || !this.#started) return;
        for (const team of teams.value) {
          const stored = yield* Effect.promise(() => this.#options.selectTeamKey(team.id));
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
              signingKey: machine.signingKey ?? null,
              tasks: [],
              updatedAt: null,
              attempt: 0,
              stop: null,
            };
            this.#feeds.push(feed);
            if (machine.online) this.#connect(feed);
          }
        }
        this.#publish(yield* readNow(this.#options));
      })
    );
  }

  stop() {
    this.#started = false;
    for (const feed of this.#feeds) feed.stop?.();
    this.#feeds = [];
    this.#snapshot = NO_TEAM_FEED;
  }

  #isShown(feed: HostedFeed, now: number) {
    if (feed.updatedAt === null) return false;
    return feed.machine.status === 'live' || !isTeamSnapshotExpired(feed.updatedAt, now);
  }

  #publish(now: number) {
    this.#snapshot = {
      machines: this.#feeds.map((feed) =>
        feed.machine.status !== 'live' && feed.updatedAt !== null && this.#isShown(feed, now)
          ? { ...feed.machine, updatedAt: feed.updatedAt }
          : feed.machine
      ),
      tasks: this.#feeds.flatMap((feed) =>
        this.#isShown(feed, now)
          ? feed.tasks.map((task) => ({
              ...task,
              teamId: feed.target.teamId,
              instanceId: feed.target.instanceId,
            }))
          : []
      ),
    };
    this.#signal.publish();
  }

  #canAdopt(feed: HostedFeed) {
    return this.#started && (feed.machine.status === 'offline' || feed.machine.status === 'connecting');
  }

  #adoptHeld(teamId: string, held: readonly TeamSnapshot[]) {
    return Effect.gen({ self: this }, function* () {
      let adopted = false;
      for (const snapshot of held) {
        const instanceId = selectTeamSnapshotSigner(snapshot);
        const feed = this.#feeds.find(
          (candidate) => candidate.target.teamId === teamId && candidate.target.instanceId === instanceId
        );
        if (!(feed?.signingKey && this.#canAdopt(feed))) continue;
        const body = yield* verifyTeamSnapshot(feed.signingKey, snapshot);
        if (!(body && body.teamId === teamId && body.instanceId === instanceId && this.#canAdopt(feed)))
          continue;
        const now = yield* readNow(this.#options);
        if (isTeamSnapshotExpired(body.updatedAt, now) || (feed.updatedAt ?? -1) >= body.updatedAt) continue;
        feed.tasks = body.tasks;
        feed.updatedAt = body.updatedAt;
        adopted = true;
      }
      if (adopted) this.#publish(yield* readNow(this.#options));
    });
  }

  #mark(feed: HostedFeed, status: TeamFeedMachine['status'], reason: string | null) {
    const { presence: _, ...machine } = feed.machine;
    feed.machine = { ...machine, status, reason };
  }

  #receive(feed: HostedFeed, message: ShareMessage) {
    if (message.t !== 'view') return;
    forkApp(
      Effect.gen({ self: this }, function* () {
        const view = decodeListView(message.data);
        if (Option.isNone(view)) return;
        const now = yield* readNow(this.#options);
        feed.tasks = view.value.tasks;
        feed.updatedAt = view.value.updatedAt ?? now;
        feed.attempt = 0;
        this.#mark(feed, 'live', null);
        if (view.value.presence?.length) feed.machine = { ...feed.machine, presence: view.value.presence };
        this.#publish(now);
        yield* this.#adoptHeld(feed.target.teamId, view.value.held ?? []);
      })
    );
  }

  #end(feed: HostedFeed, end: { reason: string; gone: boolean }) {
    const wait = this.#options.wait ?? waitOnTimer;
    forkApp(
      Effect.gen({ self: this }, function* () {
        if (end.gone) {
          feed.tasks = [];
          feed.updatedAt = null;
        }
        this.#mark(feed, end.gone ? 'refused' : 'offline', end.reason);
        this.#publish(yield* readNow(this.#options));
        const steps = end.gone ? FEED_REFUSED_RETRY_MS : FEED_RETRY_MS;
        const delay = steps[Math.min(feed.attempt, steps.length - 1)] as number;
        feed.attempt += 1;
        const cancel = wait(delay, () => {
          if (this.#started && feed.stop === cancel) this.#connect(feed);
        });
        feed.stop = cancel;
      })
    );
  }

  #connect(feed: HostedFeed) {
    const open = this.#options.openChannel ?? openTeamChannel;
    feed.stop = open(feed.target, {
      onMessage: (message) => {
        if (this.#started) this.#receive(feed, message);
      },
      onEnd: (end) => {
        feed.stop = null;
        if (this.#started) this.#end(feed, end);
      },
    });
  }
}

export interface TeamFeedRefusal {
  key: string;
  machine: string;
  owner: RemoteUser | null;
  team: string;
  waitsForKey: boolean;
  reason: string;
}

export const TEAM_FEED_REFUSED = 'It refused to list its tasks.';

export const TEAM_FEED_WAITS_FOR_KEY =
  'It gets the key once its owner gives it access from another of their machines, or the team’s owner does.';

export interface RefusalTeam {
  id: string;
  name: string;
  team: Pick<RemoteTeam, 'owner' | 'members'> | null;
}

export function listTeamFeedRefusals(
  feed: TeamFeedSnapshot,
  teams: readonly RefusalTeam[],
  reachable: ReadonlySet<string>,
  focusTeamId: string | null
): TeamFeedRefusal[] {
  const byId = new Map(teams.map((team) => [team.id, team]));
  return feed.machines
    .flatMap((machine): TeamFeedRefusal[] => {
      const team = byId.get(machine.teamId);
      if (machine.status !== 'refused' || team === undefined || reachable.has(machine.instanceId)) return [];
      if (focusTeamId !== null && machine.teamId !== focusTeamId) return [];
      return [
        {
          key: resolveMachineKey(machine),
          machine: describeMachineName(machine.name),
          owner: team.team ? selectTeamPerson(team.team, machine.userId) : null,
          team: team.name,
          waitsForKey: machine.reason === TEAM_REFUSALS.key,
          reason: machine.reason ?? TEAM_FEED_REFUSED,
        },
      ];
    })
    .sort((left, right) => left.machine.localeCompare(right.machine));
}

export function describeTeamFeedRefusals(refusals: readonly TeamFeedRefusal[]): {
  label: Mention;
  detail: string;
} | null {
  const [first] = refusals;
  if (!first) return null;
  if (refusals.length > 1)
    return {
      label: [`${refusals.length} teammate machines are not listing their tasks`],
      detail: refusals.map((refusal) => `${describeRefusalMachine(refusal)}: ${refusal.reason}`).join(' '),
    };
  const owner: Mention = first.owner ? [' by ', { user: first.owner }] : [];
  const outcome = first.waitsForKey ? 'is waiting for the team’s key' : 'is not listing its tasks';
  const detail = first.waitsForKey ? TEAM_FEED_WAITS_FOR_KEY : first.reason;
  return { label: [first.machine, ...owner, ` in ${first.team} ${outcome}`], detail };
}

function describeRefusalMachine(refusal: TeamFeedRefusal) {
  return refusal.owner ? `${refusal.machine} (${resolveFirstName(refusal.owner)})` : refusal.machine;
}
