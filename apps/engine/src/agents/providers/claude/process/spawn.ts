import { spawn } from 'node:child_process';
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';

export function spawnClaudeProcess(options: SpawnOptions) {
  const started = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  });
  started.stderr.setEncoding('utf8');
  return started;
}
