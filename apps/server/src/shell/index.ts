import { describeError, log, redactSecrets } from '../log/index.ts';

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandOptions {
  input?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const QUIET_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1' };

function killGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    log.warn('[Shell] Could not stop a command that ran too long', { pid, error: describeError(error) });
  }
}

function spawn(command: string[], cwd: string, options: CommandOptions) {
  try {
    return Bun.spawn(command, {
      cwd,
      stdin: options.input === undefined ? 'ignore' : new TextEncoder().encode(options.input),
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
      env: { ...Bun.env, ...QUIET_ENV, ...options.env },
    });
  } catch (error) {
    return describeError(error);
  }
}

export async function runCommand(
  command: string[],
  cwd: string,
  options: CommandOptions = {}
): Promise<CommandResult> {
  const child = spawn(command, cwd, options);
  if (typeof child === 'string') return { ok: false, code: 127, stdout: '', stderr: child, timedOut: false };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid);
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { ok: code === 0 && !timedOut, code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export function describeFailure(command: string[], result: CommandResult) {
  const reason = result.timedOut
    ? 'it ran too long and was stopped'
    : result.stderr || result.stdout || `exit ${result.code}`;
  return redactSecrets(`${command.slice(0, 3).join(' ')} failed: ${reason}`);
}

export async function runCommandOrThrow(command: string[], cwd: string, options?: CommandOptions) {
  const result = await runCommand(command, cwd, options);
  if (!result.ok) throw new Error(describeFailure(command, result));
  return result.stdout;
}
