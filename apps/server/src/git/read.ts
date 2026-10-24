import { CODE_LIMITS } from '@shinsa/core';
import { describeError } from '../log/index.ts';
import { killProcessGroup } from '../shell/index.ts';

export interface GitRead {
  ok: boolean;
  code: number;
  bytes: Uint8Array;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface GitReadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  literal?: boolean;
}

const READ_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' };

const DECODER = new TextDecoder();

function joinChunks(chunks: Uint8Array[], length: number) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, length - offset), offset);
    offset += Math.min(chunk.length, length - offset);
  }
  return bytes;
}

function failed(stderr: string, code = 127): GitRead {
  return { ok: false, code, bytes: new Uint8Array(), stderr, timedOut: false, truncated: false };
}

function spawnGit(args: string[], cwd: string, literal: boolean) {
  try {
    return Bun.spawn(['git', '-c', 'core.quotePath=false', ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
      env: { ...Bun.env, ...READ_ENV, GIT_LITERAL_PATHSPECS: literal ? '1' : '0' },
    });
  } catch (error) {
    return describeError(error);
  }
}

export async function readGit(args: string[], cwd: string, options: GitReadOptions = {}): Promise<GitRead> {
  if (options.signal?.aborted) return failed('The read was cancelled.', 130);
  const child = spawnGit(args, cwd, options.literal ?? true);
  if (typeof child === 'string') return failed(child);
  const limit = options.maxBytes ?? Number.POSITIVE_INFINITY;
  let timedOut = false;
  let truncated = false;
  const stop = () => killProcessGroup(child.pid);
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeoutMs ?? CODE_LIMITS.readMs);
  options.signal?.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const stderr = new Response(child.stderr).text();
    for await (const chunk of child.stdout) {
      chunks.push(chunk);
      length += chunk.length;
      if (length > limit) {
        truncated = true;
        stop();
        break;
      }
    }
    const code = await child.exited;
    return {
      ok: (code === 0 || truncated) && !timedOut,
      code,
      bytes: joinChunks(chunks, Math.min(length, limit)),
      stderr: (await stderr).trim(),
      timedOut,
      truncated,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}

export function decodeText(bytes: Uint8Array) {
  return DECODER.decode(bytes);
}

export function splitRecords(bytes: Uint8Array) {
  return decodeText(bytes)
    .split('\0')
    .filter((record) => record.length > 0);
}
