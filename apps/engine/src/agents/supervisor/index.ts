import { Scope } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import { acquireAgentSession } from '../providers/session/service.ts';
import type { AgentSession } from '../providers/types.ts';
import type { TaskScopesHandle } from './schema.ts';
import { makeTaskScopes } from './service.ts';

export class TaskScopes {
  readonly #handle: TaskScopesHandle = edgeRuntime.runSync(
    makeTaskScopes().pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
  );

  acquire(taskId: string, session: AgentSession) {
    const handle = this.#handle;
    const scope = edgeRuntime.runSync(handle.open(taskId));
    const scoped = edgeRuntime.runSync(acquireAgentSession(() => session).pipe(Scope.provide(scope)));
    return {
      done: edgeRuntime.runPromise(scoped.done),
      close: () => edgeRuntime.runPromise(handle.close(taskId, scope)),
    };
  }

  closeAll() {
    return edgeRuntime.runPromise(this.#handle.closeAll);
  }
}
