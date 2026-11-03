import { homedir } from 'node:os';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { CommandOptions, CommandResult } from '../shell/index.ts';
import { type CswapHandle, CswapListFailed } from './cswap/schema.ts';
import { makeCswap } from './cswap/service.ts';

export { parseCswapList } from './answers.ts';

export type CswapRunner = (command: string[], cwd: string, options: CommandOptions) => Promise<CommandResult>;

export interface CswapOptions {
  run: CswapRunner;
  which?: (command: string) => string | null;
  now?: () => number;
}

export class Cswap {
  readonly handle: CswapHandle;

  constructor(options: CswapOptions) {
    const which = options.which ?? ((command: string) => Bun.which(command));
    const now = options.now ?? Date.now;
    this.handle = edgeRuntime.runSync(
      makeCswap({
        run: (command, cwd, commandOptions) =>
          Effect.tryPromise({
            try: () => options.run(command, cwd, commandOptions),
            catch: (error) => new CswapListFailed({ message: describeError(error) }),
          }),
        which: (command) => Effect.sync(() => which(command)),
        now: Effect.sync(now),
        home: homedir(),
      })
    );
  }

  list() {
    return edgeRuntime.runPromise(this.handle.list);
  }
}
