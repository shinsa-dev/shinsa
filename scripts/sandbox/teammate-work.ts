import { join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import { selectServiceRunIn } from '../../apps/engine/src/terminals/runs.ts';
import type { Task } from '../../packages/core/src/index.ts';
import { SANDBOX_SERVICE_COMMAND } from '../seed/services.ts';
import type { StartedMachine } from './machine.ts';
import { SandboxFailed } from './schema.ts';

const TEAMMATE_SHOT = join(import.meta.dirname, '../seed-media/review-spots-1280-light-after.png');

export const seedTeammateWork = Effect.fn('Sandbox.seedTeammateWork')(function* (
  teammate: StartedMachine,
  dataDir: string,
  task: Task | undefined
) {
  const { engine, evidence, terminals } = teammate;
  const repo = task?.repoId ? (yield* engine.core.state).repos[task.repoId] : undefined;
  if (!(task && repo && task.branch))
    return yield* new SandboxFailed({ message: 'No teammate task to give a screenshot and a service.' });
  const worktree = join(dataDir, '..', 'worktrees', task.handle ?? task.id);
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(worktree, { recursive: true })
    .pipe(
      Effect.mapError(
        (error) => new SandboxFailed({ message: `Making ${worktree} failed: ${error.message}` })
      )
    );
  yield* engine.core.dispatch({
    type: 'worktree.ready',
    taskId: task.id,
    path: worktree,
    branch: task.branch,
  });
  const run = Object.values((yield* engine.core.state).runs).find((entry) => entry.taskId === task.id);
  if (!run) return yield* new SandboxFailed({ message: 'The teammate task did not start planning.' });
  const uri = yield* evidence
    .copyFile(TEAMMATE_SHOT, { taskId: task.id, round: 1 }, 'Duplicate in the paywall menu')
    .pipe(
      Effect.mapError(
        (error) => new SandboxFailed({ message: `Copying the screenshot failed: ${error.message}` })
      )
    );
  yield* engine.core.dispatch({
    type: 'agent.attach_evidence',
    runId: run.id,
    kind: 'screenshot',
    title: 'Duplicate in the paywall menu',
    uri,
    width: 1280,
    theme: 'light',
    stage: 'after',
  });
  const service = yield* terminals
    .addService(repo.projectId ?? '', {
      name: 'web',
      cwd: repo.path,
      command: SANDBOX_SERVICE_COMMAND,
      env: { SANDBOX_SERVICE: 'web', SANDBOX_PROJECT: 'Paywalls' },
      previewUrl: 'http://localhost:{port}/',
      portVariable: 'PORT',
    })
    .pipe(
      Effect.mapError(
        (error) => new SandboxFailed({ message: `Adding Kai’s web service failed: ${error.message}` })
      )
    );
  const place = yield* selectServiceRunIn(yield* engine.core.state, service, task.id, terminals);
  if (Option.isNone(place))
    return yield* new SandboxFailed({ message: 'Kai’s web service cannot run in his task.' });
  yield* terminals.startService(service.id, place.value);
});
