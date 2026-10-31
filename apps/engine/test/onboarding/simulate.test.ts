import { describe, expect, test } from 'bun:test';
import { createSetupSimulation } from '../../src/onboarding/simulate.ts';

const INSTALLED = () => Promise.resolve({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false });

describe('createSetupSimulation', () => {
  test('answers the checks of the tools it leaves out like a Mac without them, and runs every other command', async () => {
    const { run } = createSetupSimulation(['git', 'gh_auth', 'bun'], INSTALLED);
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
    const { run, scripts } = createSetupSimulation(['bun'], INSTALLED);
    expect(scripts.resolve('bun')).toBe(
      "printf '%s\\n' 'Simulated setup: nothing is installed.' '$ curl -fsSL https://bun.sh/install | bash'; sleep 2"
    );
    expect(await run(['bun', '--version'], '/')).toMatchObject({ ok: true });
    expect(scripts.resolve('nope')).toBeNull();
  });

  test('a Homebrew install fails while Homebrew is still missing, and Homebrew brings Apple’s command line tools with it', async () => {
    const { run, scripts } = createSetupSimulation(['git', 'brew', 'gh'], INSTALLED);
    expect(scripts.resolve('gh')).toEndWith("echo 'zsh: command not found: brew'; false");
    expect(await run(['gh', '--version'], '/')).toMatchObject({ ok: false });
    scripts.resolve('brew');
    scripts.resolve('gh');
    expect(await run(['gh', '--version'], '/')).toMatchObject({ ok: true });
    expect(await run(['git', '--version'], '/')).toMatchObject({ ok: true });
  });

  test('a command from the help task only prints, quoted so nothing in it runs', () => {
    const { scripts } = createSetupSimulation(['gh'], INSTALLED);
    expect(scripts.resolveReply("echo 'hi'")).toContain("'$ echo '\\''hi'\\'''");
  });
});
