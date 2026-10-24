import { type CommandOptions, describeFailure, runCommand } from '../shell/index.ts';

const LOCKED = /Unable to create '[^']*\.lock': File exists/;

const LOCK_ATTEMPTS = 6;

const LOCK_BACKOFF_MS = 50;

export async function runGitOrThrow(args: string[], cwd: string, options: CommandOptions = {}) {
  const command = ['git', ...args];
  for (let attempt = 1; ; attempt += 1) {
    const result = await runCommand(command, cwd, options);
    if (result.ok) return result.stdout;
    if (attempt >= LOCK_ATTEMPTS || !LOCKED.test(result.stderr))
      throw new Error(describeFailure(command, result));
    await Bun.sleep(LOCK_BACKOFF_MS * 2 ** (attempt - 1));
  }
}
