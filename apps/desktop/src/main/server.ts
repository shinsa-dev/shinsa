import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { app } from 'electron';
import { parseHealth, type ServerHealth } from '../lib/health.ts';
import { parseConfigPort, resolveConfigPath, resolveServerUrl } from '../lib/server-url.ts';
import { resolveLoginShell, START_COMMANDS, summarizeOutput } from '../lib/service.ts';

const HEALTH_TIMEOUT_MS = 1500;

const SERVICE_TIMEOUT_MS = 60_000;

const START_WAIT_MS = 15_000;

const START_POLL_MS = 250;

function readConfigText() {
  try {
    return readFileSync(resolveConfigPath(process.env, homedir()), 'utf8');
  } catch {
    return null;
  }
}

export function resolveAppServerUrl() {
  return resolveServerUrl({
    env: process.env,
    packaged: app.isPackaged,
    configPort: parseConfigPort(readConfigText()),
  });
}

export async function requestHealth(url: string): Promise<ServerHealth | null> {
  try {
    const response = await fetch(new URL('/api/health', url), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseHealth(await response.json());
  } catch {
    return null;
  }
}

function runInLoginShell(command: string) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn(resolveLoginShell(process.env), ['-ilc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SERVICE_TIMEOUT_MS,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}

async function waitForHealth(url: string) {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    const health = await requestHealth(url);
    if (health) return health;
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
  }
  return null;
}

export async function requestServiceStart(url: string) {
  const outputs: string[] = [];
  for (const command of START_COMMANDS) {
    const result = await runInLoginShell(command);
    outputs.push(`$ ${command}\n${result.output}`);
    if (!result.ok) continue;
    const health = await waitForHealth(url);
    return { health, output: health ? '' : summarizeOutput(outputs.join('\n')) };
  }
  return { health: null, output: summarizeOutput(outputs.join('\n')) };
}
