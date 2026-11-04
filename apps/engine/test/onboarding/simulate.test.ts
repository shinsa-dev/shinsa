import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { createSetupSimulation } from '../../src/onboarding/simulate.ts';

const INSTALLED = () => Effect.succeed({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false });

function simulate(ids: string[]) {
  const simulation = createSetupSimulation(ids, INSTALLED);
  return {
    scripts: simulation.scripts,
    run: (command: string[], cwd: string) => Effect.runPromise(simulation.run(command, cwd)),
  };
}

describe('createSetupSimulation', () => {
  test('answers the checks of the tools it leaves out like a Mac without them, and runs every other command', async () => {
    const { run } = simulate(['git', 'gh_auth', 'bun']);
    expect(await run(['git', '--version'], '/')).toMatchObject({
      ok: false,
      stderr: expect.stringContaining('xcrun'),
    });
    expect(await run(['gh', 'auth', 'status'], '/')).toMatchObject({ ok: false, code: 1 });
    expect(await run(['bun', '--version'], '/')).toMatchObject({ ok: false, code: 127 });
    expect(await run(['gh', '--version'], '/')).toMatchObject({ ok: true });
    expect(await run(['open', 'x'], '/')).toMatchObject({ ok: true });
  });

  test('an install only prints its command, then the tool counts as installed', async () => {
    const { run, scripts } = simulate(['bun']);
    expect(scripts.resolve('bun')).toBe(
      "printf '%s\\n' 'Simulated setup: nothing is installed.' '$ curl -fsSL https://bun.sh/install | bash'; sleep 2"
    );
    expect(await run(['bun', '--version'], '/')).toMatchObject({ ok: true });
    expect(scripts.resolve('nope')).toBeNull();
  });

  test('a Homebrew install fails while Homebrew is still missing, and Homebrew brings Apple’s command line tools with it', async () => {
    const { run, scripts } = simulate(['git', 'brew', 'gh']);
    expect(scripts.resolve('gh')).toEndWith("echo 'zsh: command not found: brew'; false");
    expect(await run(['gh', '--version'], '/')).toMatchObject({ ok: false });
    scripts.resolve('brew');
    expect(scripts.resolve('gh')).not.toContain('command not found');
    expect(await run(['gh', '--version'], '/')).toMatchObject({ ok: true });
    expect(await run(['git', '--version'], '/')).toMatchObject({ ok: true });
  });

  test('installing the GitHub CLI also signs it in', async () => {
    const { run, scripts } = simulate(['gh', 'gh_auth']);
    scripts.resolve('gh');
    expect(await run(['gh', 'auth', 'status'], '/')).toMatchObject({ ok: true });
  });

  test('a command from the help task only prints, quoted so nothing in it runs', () => {
    const { scripts } = simulate(['gh']);
    expect(scripts.resolveReply("echo 'hi'")).toContain("'$ echo '\\''hi'\\'''");
  });
});
