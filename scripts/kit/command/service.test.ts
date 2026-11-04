import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { Command, CommandLayer } from './index.ts';

function runCommand<A, E>(effect: Effect.Effect<A, E, Command>) {
  return Effect.runPromise(effect.pipe(Effect.provide(CommandLayer)));
}

describe('Command', () => {
  test('reads a command’s output as text and as its non-empty lines', async () => {
    const result = await runCommand(
      Effect.gen(function* () {
        const command = yield* Command;
        return {
          text: yield* command.text(['printf', 'one\n\n  two  \n']),
          lines: yield* command.lines(['printf', 'one\n\n  two  \n']),
        };
      })
    );
    expect(result).toEqual({ text: 'one\n\n  two', lines: ['one', 'two'] });
  });

  test('passes the folder and the environment on to the command', async () => {
    const output = await runCommand(
      Command.use((command) =>
        command.text(['sh', '-c', 'printf "$GREETING in $PWD"'], { cwd: '/tmp', env: { GREETING: 'hello' } })
      )
    );
    expect(output).toMatch(/^hello in (\/private)?\/tmp$/);
  });

  test('fails with the command’s exit code and error output, never the rest of its arguments', async () => {
    const error = await runCommand(
      Effect.flip(
        Command.use((command) => command.text(['sh', '-c', 'echo "no secret here" >&2; exit 3', 'secret']))
      )
    );
    expect(error._tag).toBe('CommandFailed');
    expect(error).toMatchObject({ command: 'sh -c', code: 3, stderr: 'no secret here' });
    expect(error.message).toBe('sh -c failed (3): no secret here');
  });

  test('answers a missing program with exit code 127 instead of failing', async () => {
    const output = await runCommand(Command.use((command) => command.run(['shinsa-no-such-program'])));
    expect(output.code).toBe(127);
    expect(output.stdout).toBe('');
  });
});
