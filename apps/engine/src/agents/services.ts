import { DomainError, type ShinsaState, type Task } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ServiceRunner, ServiceToolName, TaskServiceRunner } from './services/schema.ts';
import { runServiceTool } from './services/service.ts';
import { ToolCallFailed } from './tools/schema.ts';

export {
  SERVICE_OUTPUT_LINES,
  type ServiceRunner,
  type ServiceToolName,
  type TaskServiceRunner,
} from './services/schema.ts';

function refuse(error: unknown) {
  return error instanceof DomainError ? error : new ToolCallFailed({ message: describeError(error) });
}

export function createServiceRunner(runner: TaskServiceRunner): ServiceRunner {
  return {
    home: runner.home,
    dataDir: runner.dataDir,
    snapshot: Effect.sync(() => runner.snapshot()),
    startService: (id, run) => Effect.try({ try: () => runner.startService(id, run), catch: refuse }),
    stopService: (id, taskId) =>
      Effect.tryPromise({ try: () => runner.stopService(id, taskId), catch: refuse }),
    restartService: (id, run) =>
      Effect.tryPromise({ try: () => runner.restartService(id, run), catch: refuse }),
    readServiceOutput: (id, taskId, lines) =>
      Effect.tryPromise({ try: () => runner.readServiceOutput(id, taskId, lines), catch: refuse }),
    addService: (projectId, input) =>
      Effect.try({ try: () => runner.addService(projectId, input), catch: refuse }),
    removeServices: (ids) => Effect.try({ try: () => runner.removeServices(ids), catch: refuse }),
  };
}

export function handleServiceTool(
  name: ServiceToolName,
  input: Record<string, unknown>,
  context: { state: ShinsaState; task: Task; runner: TaskServiceRunner; now: number }
) {
  return edgeRuntime.runPromise(
    runServiceTool(name, input, { ...context, runner: createServiceRunner(context.runner) })
  );
}
