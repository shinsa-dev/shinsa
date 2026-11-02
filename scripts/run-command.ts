export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (argv: string[]) => CommandResult;

export function runCommand(argv: string[]): CommandResult {
  const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
