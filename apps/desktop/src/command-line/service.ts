import { join } from 'node:path';
import { Context, Effect, Layer, Option } from 'effect';
import { resolveEngineProgram } from '../engine/launchd.ts';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { LoginShell } from '../login-shell/service.ts';
import {
  isOnPath,
  needsProfileEdit,
  parseLoginPath,
  planCommandLink,
  resolveCommandDir,
  resolveCommandLink,
  resolveLoginPathArgs,
  resolveProfileEdit,
} from './install.ts';
import { type CommandLineSync, SHELLS, type Shell } from './schema.ts';

export class CommandLine extends Context.Service<
  CommandLine,
  { readonly sync: Effect.Effect<Option.Option<CommandLineSync>> }
>()('shinsa/desktop/command-line/CommandLine') {
  static readonly layer = Layer.effect(
    CommandLine,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const loginShell = yield* LoginShell;
      const program = resolveEngineProgram(host.resourcesPath);
      const dir = resolveCommandDir(host.home);
      const isShellUsed = Effect.fn('CommandLine.isShellUsed')(function* (shell: Shell) {
        if (shell !== 'bash') return true;
        if (yield* files.exists(join(host.home, '.bash_profile'))) return true;
        return host.env.SHELL?.endsWith('/bash') === true;
      });
      const linkProgram = Effect.gen(function* () {
        const link = resolveCommandLink(host.home);
        const plan = planCommandLink(yield* files.readEntry(link), program);
        if (plan === 'keep' || plan === 'leave') return plan;
        if (plan === 'replace') yield* files.remove(link);
        yield* files.link(program, link);
        return plan;
      });
      const addToShellPath = Effect.fn('CommandLine.addToShellPath')(function* (
        shell: Shell,
        programs: readonly string[]
      ) {
        const found = yield* Effect.findFirst(programs, (candidate) => files.exists(candidate));
        if (Option.isNone(found) || !(yield* isShellUsed(shell))) return false;
        const output = yield* loginShell.run(found.value, resolveLoginPathArgs(shell));
        const path = Option.flatMapNullishOr(output, parseLoginPath);
        if (Option.isNone(path) || isOnPath(path.value, dir)) return false;
        const edit = resolveProfileEdit(shell, host.home);
        if (!needsProfileEdit(Option.getOrNull(yield* files.readText(edit.file)))) return false;
        if (edit.mode === 'append') yield* files.appendText(edit.file, edit.text);
        else yield* files.writeText(edit.file, edit.text);
        return true;
      });
      const addToShellPaths = Effect.gen(function* () {
        const added: Shell[] = [];
        for (const { shell, programs } of SHELLS) {
          if (yield* addToShellPath(shell, programs)) added.push(shell);
        }
        return added;
      });
      const sync = Effect.gen(function* () {
        if (!(yield* files.exists(program))) return Option.none<CommandLineSync>();
        const link = yield* linkProgram;
        const addedTo = yield* addToShellPaths;
        return Option.some<CommandLineSync>({ link, addedTo });
      }).pipe(
        Effect.catchTag('FileWriteFailed', (failure) =>
          Effect.as(
            Effect.logWarning('Could not put the shinsa command on your PATH').pipe(
              Effect.annotateLogs({ path: failure.path, error: failure.message })
            ),
            Option.none<CommandLineSync>()
          )
        ),
        Effect.withSpan('CommandLine.sync')
      );
      return CommandLine.of({ sync });
    })
  );
}
