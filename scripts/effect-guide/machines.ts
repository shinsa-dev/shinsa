import { Clock, Context, Effect, Layer, Option } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { Machine, MachineAlreadyPaired, MachineId, MachineNotFound, type PairRequest } from './domain.ts';

export class Machines extends Context.Service<
  Machines,
  {
    pair(request: PairRequest): Effect.Effect<Machine, MachineAlreadyPaired>;
    find(id: MachineId): Effect.Effect<Machine, MachineNotFound>;
    select(id: MachineId): Effect.Effect<Option.Option<Machine>>;
    readonly list: Effect.Effect<ReadonlyArray<Machine>>;
  }
>()('shinsa/guide/Machines') {
  static readonly layer = Layer.effect(
    Machines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const selectRow = SqlSchema.findOneOption({
        Request: MachineId,
        Result: Machine,
        execute: (id) => sql`SELECT * FROM machines WHERE id = ${id}`,
      });

      const listRows = SqlSchema.findAll({
        Request: Machine.fields.status,
        Result: Machine,
        execute: (status) => sql`SELECT * FROM machines WHERE status = ${status} ORDER BY paired_at`,
      });

      const insertRow = SqlSchema.void({
        Request: Machine,
        execute: (row) => sql`INSERT INTO machines ${sql.insert(row)}`,
      });

      const select = Effect.fn('Machines.select')((id: MachineId) => selectRow(id).pipe(Effect.orDie));

      const find = Effect.fn('Machines.find')(function* (id: MachineId) {
        const machine = yield* select(id);
        if (Option.isNone(machine)) return yield* new MachineNotFound({ machineId: id });
        return machine.value;
      });

      const pair = Effect.fn('Machines.pair')(function* (request: PairRequest) {
        if (Option.isSome(yield* select(request.id)))
          return yield* new MachineAlreadyPaired({ machineId: request.id });
        const machine = new Machine({
          ...request,
          status: 'online',
          pairedAt: yield* Clock.currentTimeMillis,
        });
        yield* insertRow(machine).pipe(Effect.orDie);
        return machine;
      });

      return Machines.of({ pair, find, select, list: listRows('online').pipe(Effect.orDie) });
    })
  );
}
