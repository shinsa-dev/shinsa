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
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const QUIET_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1' };

function readErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : null;
}

function isLeaderSignalled(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

export function killProcessGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    const code = readErrorCode(error);
    if (code === 'ESRCH' || (code === 'EPERM' && isLeaderSignalled(pid))) return;
    log.warn('[Shell] Could not stop a command', { pid, error: describeError(error) });
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
  if (options.signal?.aborted) {
    return {
      ok: false,
      code: 130,
      stdout: '',
      stderr: 'The command was cancelled before it started.',
      timedOut: false,
    };
  }
  const child = spawn(command, cwd, options);
  if (typeof child === 'string') return { ok: false, code: 127, stdout: '', stderr: child, timedOut: false };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child.pid);
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  const stop = () => killProcessGroup(child.pid);
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { ok: code === 0 && !timedOut, code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
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
