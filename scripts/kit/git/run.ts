import type { GitOptions } from './schema.ts';

export function runGit(args: string[], cwd: string, options: GitOptions = {}) {
  const date = options.at === undefined ? null : `@${Math.floor(options.at / 1000)} +0000`;
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdin:
      typeof options.input === 'string'
        ? new TextEncoder().encode(options.input)
        : (options.input ?? 'ignore'),
    env: {
      ...Bun.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...options.env,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      ...(options.index ? { GIT_INDEX_FILE: options.index } : {}),
    },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
