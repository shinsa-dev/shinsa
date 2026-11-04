import { Context, Effect, Layer, Ref } from 'effect';
import { Terminals } from '../../terminals/service.ts';
import type { ProcessRoot, ProcessTracker } from '../schema.ts';

export class ProcessLedger extends Context.Service<
  ProcessLedger,
  {
    readonly track: ProcessTracker;
    readonly listRoots: Effect.Effect<ProcessRoot[]>;
  }
>()('shinsa/engine/resources/ledger/ProcessLedger') {
  static readonly layer = Layer.effect(
    ProcessLedger,
    Effect.gen(function* () {
      const terminals = yield* Terminals;
      const roots = yield* Ref.make<ReadonlyMap<number, ProcessRoot>>(new Map());

      const track = Effect.fn('ProcessLedger.track')(function* (
        taskId: string,
        kind: ProcessRoot['kind'],
        pid: number
      ) {
        const root: ProcessRoot = { taskId, kind, pid };
        yield* Ref.update(roots, (current) => new Map(current).set(pid, root));
        return Ref.update(roots, (current) => {
          if (current.get(pid) !== root) return current;
          const next = new Map(current);
          next.delete(pid);
          return next;
        });
      });

      const listRoots = Effect.gen(function* () {
        const services = (yield* terminals.listServiceProcesses).map((service) => ({
          ...service,
          kind: 'services' as const,
        }));
        return [...(yield* Ref.get(roots)).values(), ...services];
      });

      return ProcessLedger.of({ track, listRoots });
    })
  );
}
