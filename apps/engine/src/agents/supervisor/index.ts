import { Scope } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import { acquireAgentSession } from '../providers/session/service.ts';
import type { AgentSession } from '../providers/types.ts';
import type { RunScopeRequest, TaskScopesHandle } from './schema.ts';
import { makeTaskScopes } from './service.ts';

export class TaskScopes {
  readonly #handle: TaskScopesHandle = edgeRuntime.runSync(
    makeTaskScopes().pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
  );

  acquire(request: RunScopeRequest, session: AgentSession) {
    const handle = this.#handle;
    const scope = edgeRuntime.runSync(handle.open(request));
    const scoped = edgeRuntime.runSync(acquireAgentSession(() => session).pipe(Scope.provide(scope)));
    return {
      done: edgeRuntime.runPromise(scoped.done),
      close: () => edgeRuntime.runPromise(handle.close(request.runId)),
    };
  }

  cancel(runId: string) {
    return edgeRuntime.runPromise(this.#handle.closeRun(runId));
  }

  closeAll() {
    return edgeRuntime.runPromise(this.#handle.closeAll);
  }
}
