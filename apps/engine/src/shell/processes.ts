import { Effect, Predicate } from 'effect';
import { describeError } from '../log/redact.ts';
import { NO_SUCH_PROCESS, NOT_PERMITTED, SignalRefused } from './schema.ts';

function readErrorCode(error: unknown) {
  return Predicate.hasProperty(error, 'code') && Predicate.isString(error.code) ? error.code : null;
}

const sendKill = (pid: number) =>
  Effect.try({
    try: () => {
      process.kill(pid, 'SIGKILL');
    },
    catch: (error) => new SignalRefused({ code: readErrorCode(error), message: describeError(error) }),
  });

export const stopProcessGroup = Effect.fn('stopProcessGroup')(function* (pid: number) {
  yield* sendKill(-pid).pipe(
    Effect.catchTag('SignalRefused', (refused) => {
      if (refused.code === NO_SUCH_PROCESS) return Effect.void;
      const leaderSignalled =
        refused.code === NOT_PERMITTED ? Effect.isSuccess(sendKill(pid)) : Effect.succeed(false);
      return Effect.flatMap(leaderSignalled, (signalled) =>
        signalled
          ? Effect.void
          : Effect.logWarning('[Shell] Could not stop a command').pipe(
              Effect.annotateLogs({ pid, error: refused.message })
            )
      );
    })
  );
});

export const stopProcess = Effect.fn('stopProcess')(function* (pid: number) {
  yield* sendKill(pid).pipe(
    Effect.catchTag('SignalRefused', (refused) =>
      refused.code === NO_SUCH_PROCESS
        ? Effect.void
        : Effect.logWarning('[Shell] Could not stop a process').pipe(
            Effect.annotateLogs({ pid, error: refused.message })
          )
    )
  );
});

export function listDescendants(table: string, root: number) {
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const child of children.get(parent) ?? []) {
      if (found.includes(child) || child === root) continue;
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}
