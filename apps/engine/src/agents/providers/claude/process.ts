import { type ChildProcess, spawn } from 'node:child_process';
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { killProcessTree } from '../../../shell/index.ts';

export interface ClaudeProcess {
  spawn: (options: SpawnOptions) => SpawnedProcess;
  readStderr: () => string;
  terminate: () => Promise<void>;
}

const STDERR_TAIL_CHARS = 8_000;

export function createClaudeProcess(): ClaudeProcess {
  let child: ChildProcess | null = null;
  let stderr = '';
  return {
    spawn: (options) => {
      const started = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        windowsHide: true,
      });
      started.stderr.setEncoding('utf8');
      started.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
      });
      child = started;
      return started as unknown as SpawnedProcess;
    },
    readStderr: () => stderr.trim(),
    terminate: async () => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
      await killProcessTree(child.pid);
    },
  };
}
