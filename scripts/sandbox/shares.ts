import { normalizeRemote } from '../../apps/engine/src/git/repo.ts';
import type { Engine } from '../../apps/engine/src/runtime/index.ts';
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
  ORIGIN,
  PORT,
  type PreviewShare,
  SANDBOX_PATH,
  SEEDED_MESSAGES,
} from './schema.ts';

export function createShareLink(instanceId: string): ShareLink {
  return { instanceId, shareId: createRandomKey(SHARE_ID_BYTES), key: createRandomKey(SHARE_KEY_BYTES) };
}

function countStoredEvidence(engine: Engine, taskId: string) {
  return Object.values(engine.state.evidence).filter(
    (item) => item.taskId === taskId && item.uri.startsWith('/api/evidence/')
  ).length;
}

function countRuns(engine: Engine, taskId: string) {
  return Object.values(engine.state.runs).filter((run) => run.taskId === taskId).length;
}

function hasBranch(repo: Repo, branch: string) {
  return Bun.spawnSync(['git', '-C', repo.path, 'rev-parse', '--verify', '--quiet', branch]).exitCode === 0;
}

async function normalizeSeedRemote(engine: Engine, repo: Repo) {
  if (!repo.remote) return repo;
  await engine.dispatch({
    type: 'repo.update',
    repoId: repo.id,
    patch: { remote: normalizeRemote(repo.remote) },
  });
  return engine.state.repos[repo.id] ?? repo;
}

async function createPreviewShare(
  studio: StartedMachine,
  task: Task,
  label: string,
  preset: SharePreset = 'standard'
): Promise<PreviewShare | null> {
  const seeded = task.repoId ? studio.engine.state.repos[task.repoId] : undefined;
  if (!seeded) return null;
  await normalizeSeedRemote(studio.engine, seeded);
  const url = serializeShareUrl(ORIGIN, createShareLink(studio.machine.id));
  if (!task.share)
    await studio.engine.dispatch({ type: 'task.share', taskId: task.id, limit: 'none', preset });
  await studio.engine.dispatch({ type: 'share.record', taskId: task.id, url });
  return { url, label, handle: task.handle ?? task.id, port: studio.machine.port };
}

async function recordPushedHead(engine: Engine, task: Task) {
  const repo = task.repoId ? engine.state.repos[task.repoId] : undefined;
  if (!(repo && task.branch && task.pullRequest) || task.pullRequest.headSha) return task;
  const parsed = Bun.spawnSync(['git', '-C', repo.path, 'rev-parse', task.branch]);
  const headSha = parsed.stdout.toString().trim();
  await engine.dispatch({
    type: 'pull_request.record',
    taskId: task.id,
    pullRequest: { ...task.pullRequest, headSha },
  });
  return engine.state.tasks[task.id] ?? task;
}

function seedMessages(studio: StartedMachine, task: Task) {
  const [run] = Object.values(studio.engine.state.runs)
    .filter((entry) => entry.taskId === task.id)
    .sort((left, right) => right.startedAt - left.startedAt);
  if (!run) return;
  for (const text of SEEDED_MESSAGES)
    studio.transcripts.record(run.id, { type: 'user', from: 'you', text, attachments: [] });
}

export async function createPreviewShares(studio: StartedMachine) {
  const { engine } = studio;
  const tasks = Object.values(engine.state.tasks).filter((entry) => entry.report && entry.repoId);
  const coded = tasks.find((entry) => {
    const repo = entry.repoId ? engine.state.repos[entry.repoId] : undefined;
    return entry.pullRequest?.state === 'open' && entry.branch && repo && hasBranch(repo, entry.branch);
  });
  const [evidenced] = tasks.sort(
    (left, right) => countStoredEvidence(engine, right.id) - countStoredEvidence(engine, left.id)
  );
  const pushed = coded && (await recordPushedHead(engine, coded));
  const taken = new Set([pushed?.id, evidenced?.id]);
  const [talked] = tasks
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => countRuns(engine, right.id) - countRuns(engine, left.id));
  const [, chatty] = tasks
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => countRuns(engine, right.id) - countRuns(engine, left.id));
  const status = tasks.find(
    (entry) => !taken.has(entry.id) && entry.id !== talked?.id && entry.id !== chatty?.id
  );
  for (const task of [talked, chatty]) if (task) seedMessages(studio, task);
  const shares = [
    pushed &&
      (await createPreviewShare(studio, pushed, 'A shared task with an open pull request, with Code')),
    evidenced &&
      evidenced.id !== pushed?.id &&
      (await createPreviewShare(studio, evidenced, 'A shared task with its evidence')),
    status &&
      (await createPreviewShare(studio, status, 'A task shared as Status, the status card', 'status')),
    talked &&
      (await createPreviewShare(
        studio,
        talked,
        'A task shared as Standard, with the agents’ live output in Chat',
        'standard'
      )),
    chatty &&
      (await createPreviewShare(
        studio,
        chatty,
        'A task shared as Full access, with your messages in Chat too',
        'full'
      )),
  ];
  return shares.filter((share): share is PreviewShare => Boolean(share));
}

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
