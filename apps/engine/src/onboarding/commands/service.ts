import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { runCommand } from '../../shell/command.ts';
import { Shell } from '../../shell/service.ts';
import { INSTALL_SCRIPTS, type InstallScripts } from '../install.ts';
import type { CommandRunner } from '../schema.ts';
import { createSetupSimulation } from '../simulate.ts';

export class SetupCommands extends Context.Service<
  SetupCommands,
  {
    readonly run: CommandRunner;
    readonly scripts: InstallScripts;
  }
>()('shinsa/engine/onboarding/commands/SetupCommands') {
  static readonly layer = Layer.effect(
    SetupCommands,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const { simulateMissing } = yield* EngineConfig;
      const run: CommandRunner = (command, cwd, options) =>
        runCommand(command, cwd, options).pipe(Effect.provideService(Shell, shell));
      if (simulateMissing.length === 0) return SetupCommands.of({ run, scripts: INSTALL_SCRIPTS });
      return SetupCommands.of(createSetupSimulation(simulateMissing, run));
    })
  );
}
