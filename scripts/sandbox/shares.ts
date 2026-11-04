import { Effect, Option } from 'effect';
import { normalizeRemote } from '../../apps/engine/src/git/remote/output.ts';
import { Shell } from '../../apps/engine/src/shell/index.ts';
import {
  type Repo,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  type ShareConnectResponse,
  type ShareLink,
  type SharePreset,
  serializeShareUrl,
  type Task,
} from '../../packages/core/src/index.ts';
import type { StartedMachine } from './machine.ts';
import { createRandomKey } from './requests.ts';
import {
  HOST,
  type Machine,
  GIT_TIMEOUT,
  ORIGIN,
  PORT,
  type PreviewShare,
  SANDBOX_PATH,
  SEEDED_MESSAGES,
} from './schema.ts';

export function createShareLink(instanceId: string): ShareLink {
  return { instanceId, shareId: createRandomKey(SHARE_ID_BYTES), key: createRandomKey(SHARE_KEY_BYTES) };
}

export const createPreviewShares = Effect.fn('Sandbox.createPreviewShares')(function* (
  studio: StartedMachine
) {
  const shell = yield* Shell;
  const { engine } = studio;
  const { core } = engine;

  const runGit = Effect.fn('Sandbox.runGit')(function* (repo: Repo, args: string[]) {
    return yield* shell.run({
      argv: ['git', '-C', repo.path, ...args],
      cwd: repo.path,
      timeout: GIT_TIMEOUT,
    });
  });

  const recordPushedHead = Effect.fn('Sandbox.recordPushedHead')(function* (task: Task) {
    const repo = task.repoId ? (yield* core.state).repos[task.repoId] : undefined;
    if (!(repo && task.branch && task.pullRequest) || task.pullRequest.headSha) return task;
    const parsed = yield* runGit(repo, ['rev-parse', task.branch]);
    yield* core.dispatch({
      type: 'pull_request.record',
      taskId: task.id,
      pullRequest: { ...task.pullRequest, headSha: parsed.stdout },
    });
    return (yield* core.state).tasks[task.id] ?? task;
  });

  const seedMessages = Effect.fn('Sandbox.seedMessages')(function* (task: Task) {
    const [run] = Object.values((yield* core.state).runs)
      .filter((entry) => entry.taskId === task.id)
      .sort((left, right) => right.startedAt - left.startedAt);
    if (!run) return;
    for (const text of SEEDED_MESSAGES)
      yield* studio.transcripts.record(run.id, { type: 'user', from: 'you', text, attachments: [] });
  });

  const createPreviewShare = Effect.fn('Sandbox.createPreviewShare')(function* (
    task: Task,
    label: string,
    preset: SharePreset = 'standard'
  ) {
    const seeded = task.repoId ? (yield* core.state).repos[task.repoId] : undefined;
    if (!seeded) return null;
    if (seeded.remote)
      yield* core.dispatch({
        type: 'repo.update',
        repoId: seeded.id,
        patch: { remote: normalizeRemote(seeded.remote) },
      });
    const url = serializeShareUrl(ORIGIN, createShareLink(studio.machine.id));
    if (!task.share) yield* core.dispatch({ type: 'task.share', taskId: task.id, limit: 'none', preset });
    yield* core.dispatch({ type: 'share.record', taskId: task.id, url });
    const share: PreviewShare = { url, label, handle: task.handle ?? task.id, port: studio.machine.port };
    return share;
  });

  const state = yield* core.state;
  const countStoredEvidence = (taskId: string) =>
    Object.values(state.evidence).filter(
      (item) => item.taskId === taskId && item.uri.startsWith('/api/evidence/')
    ).length;
  const countRuns = (taskId: string) =>
    Object.values(state.runs).filter((run) => run.taskId === taskId).length;
  const tasks = Object.values(state.tasks).filter((entry) => entry.report && entry.repoId);
  const coded = yield* Effect.findFirst(tasks, (entry) => {
    const repo = entry.repoId ? state.repos[entry.repoId] : undefined;
    if (!(entry.pullRequest?.state === 'open' && entry.branch && repo)) return Effect.succeed(false);
    return Effect.map(
      runGit(repo, ['rev-parse', '--verify', '--quiet', entry.branch]),
      (result) => result.ok
    );
  });
  const [evidenced] = tasks.sort(
    (left, right) => countStoredEvidence(right.id) - countStoredEvidence(left.id)
  );
  const pushed = Option.isSome(coded) ? yield* recordPushedHead(coded.value) : undefined;
  const taken = new Set([pushed?.id, evidenced?.id]);
  const [talked, chatty] = tasks
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => countRuns(right.id) - countRuns(left.id));
  const status = tasks.find(
    (entry) => !taken.has(entry.id) && entry.id !== talked?.id && entry.id !== chatty?.id
  );
  for (const task of [talked, chatty]) if (task) yield* seedMessages(task);
  const shares = [
    pushed && (yield* createPreviewShare(pushed, 'A shared task with an open pull request, with Code')),
    evidenced &&
      evidenced.id !== pushed?.id &&
      (yield* createPreviewShare(evidenced, 'A shared task with its evidence')),
    status && (yield* createPreviewShare(status, 'A task shared as Status, the status card', 'status')),
    talked &&
      (yield* createPreviewShare(
        talked,
        'A task shared as Standard, with the agents’ live output in Chat',
        'standard'
      )),
    chatty &&
      (yield* createPreviewShare(
        chatty,
        'A task shared as Full access, with your messages in Chat too',
        'full'
      )),
  ];
  return shares.filter((share): share is PreviewShare => Boolean(share));
});

export function respondShareConnect(match: RegExpExecArray, machines: Machine[]) {
  const machine = machines.find((entry) => entry.id === match[1]);
  if (!machine)
    return Response.json(
      { error: { code: 'not_found', message: 'This task is no longer shared, or the link is wrong.' } },
      { status: 404 }
    );
  const answer: ShareConnectResponse = {
    url: `ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${machine.id}`,
    online: true,
  };
  return Response.json(answer);
}
