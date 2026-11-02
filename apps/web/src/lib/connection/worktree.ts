import { Effect } from 'effect';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { WorktreeNotOpened } from './schema.ts';

type OpenTarget = 'editor' | 'finder';

const TARGET_NAME: Record<OpenTarget, string> = {
  editor: 'the editor',
  finder: 'Finder',
};

const requestOpen = Effect.fn('Worktree.open')(function* (
  taskId: string,
  target: OpenTarget,
  path?: string,
  line?: number
) {
  const engine = yield* EngineClient;
  const opened = yield* engine.tasks.open({
    params: { taskRef: taskId },
    payload: { target, ...(path === undefined ? {} : { path }), ...(line === undefined ? {} : { line }) },
  });
  if (!opened.ok)
    return yield* new WorktreeNotOpened({ message: `Couldn’t open the worktree in ${TARGET_NAME[target]}` });
});

export function openWorktree(taskId: string, target: OpenTarget, path?: string, line?: number) {
  return requestWithToast(() => runApp(requestOpen(taskId, target, path, line)));
}
