import { execFile } from 'node:child_process';
import { Duration, Effect, Layer } from 'effect';
import { LAUNCHCTL_PROGRAM, LAUNCHCTL_TIMEOUT } from '../launchctl/schema.ts';
import { Launchctl } from '../launchctl/service.ts';

export const LaunchctlLive = Layer.succeed(
  Launchctl,
  Launchctl.of({
    run: (args) =>
      Effect.callback<{ ok: boolean; output: string }>((resume) => {
        const child = execFile(
          LAUNCHCTL_PROGRAM,
          [...args],
          { timeout: Duration.toMillis(LAUNCHCTL_TIMEOUT) },
          (error, stdout, stderr) => resume(Effect.succeed({ ok: !error, output: `${stdout}${stderr}` }))
        );
        return Effect.sync(() => child.kill());
      }),
  })
);
