import { Effect, Layer, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { LAUNCHCTL_PROGRAM, LAUNCHCTL_TIMEOUT } from '../launchctl/schema.ts';
import { Launchctl } from '../launchctl/service.ts';
import { runProcess } from '../processes/run.ts';

export const LaunchctlLive = Layer.effect(
  Launchctl,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Launchctl.of({
      run: (args) =>
        runProcess(LAUNCHCTL_PROGRAM, args, { timeout: LAUNCHCTL_TIMEOUT }).pipe(
          Effect.map(
            Option.match({
              onNone: () => ({ ok: false, output: '' }),
              onSome: (result) => ({ ok: result.ok, output: `${result.stdout}${result.stderr}` }),
            })
          ),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        ),
    });
  })
);
