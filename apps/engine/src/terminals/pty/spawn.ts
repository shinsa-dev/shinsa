import type { TerminalSpawnOptions } from '../schema.ts';

export function spawnTerminal(command: readonly string[], options: TerminalSpawnOptions) {
  return Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
      name: 'xterm-256color',
      data: (_terminal, data) => options.onData(data),
    },
  });
}
