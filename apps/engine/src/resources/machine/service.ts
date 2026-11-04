import { cpus } from 'node:os';
import { Context, Effect, Layer } from 'effect';
import { constant } from 'effect/Function';
import type { Argv, CommandResult } from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';
import { readMemoryWith, readResourceText } from '../memory.ts';
import { COMMAND_MISSING, type ResourceReadFailed } from '../monitor/schema.ts';
import { type CpuTimes, type MemoryReading, RESOURCE_COMMAND_TIMEOUT } from '../schema.ts';

export class ResourceMachine extends Context.Service<
  ResourceMachine,
  {
    readonly cores: number;
    readonly cpuTimes: Effect.Effect<CpuTimes>;
    readonly memory: Effect.Effect<MemoryReading | null, ResourceReadFailed>;
    run(argv: Argv, cwd: string): Effect.Effect<CommandResult>;
  }
>()('shinsa/engine/resources/machine/ResourceMachine') {
  static readonly layer = Layer.effect(
    ResourceMachine,
    Effect.gen(function* () {
      const shell = yield* Shell;

      const run = Effect.fn('ResourceMachine.run')(function* (argv: Argv, cwd: string) {
        return yield* shell
          .run({ argv, cwd, timeout: RESOURCE_COMMAND_TIMEOUT })
          .pipe(Effect.orElseSucceed(constant(COMMAND_MISSING)));
      });

      const cpuTimes = Effect.sync(() =>
        cpus().reduce(
          (sum, cpu) => {
            const busy = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
            return { busy: sum.busy + busy, total: sum.total + busy + cpu.times.idle };
          },
          { busy: 0, total: 0 }
        )
      );

      return ResourceMachine.of({
        cores: cpus().length,
        cpuTimes,
        memory: readMemoryWith(process.platform, (argv) => run(argv, '/'), readResourceText),
        run,
      });
    })
  );
}
