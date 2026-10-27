import { afterAll, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const STRAY_GH_WAIT_MS = 3_000;

const home = mkdtempSync(join(tmpdir(), 'shinsa-test-home-'));
const gitConfig = join(home, 'gitconfig');
const ghRegistry = join(home, 'gh-processes');
mkdirSync(ghRegistry);
const codexRegistry = join(home, 'codex-processes');
mkdirSync(codexRegistry);
const eunoeRegistry = join(home, 'eunoe-processes');
mkdirSync(eunoeRegistry);
const mcpRegistry = join(home, 'mcp-processes');
mkdirSync(mcpRegistry);
writeFileSync(
  gitConfig,
  '[user]\n\tname = Shinsa Test\n\temail = test@shinsa.dev\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n'
);

process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_OPTIONAL_LOCKS = '0';
process.env.PATH = `${resolve(import.meta.dirname, 'bin')}:${process.env.PATH ?? ''}`;
process.env.SHINSA_QUICK = 'off';
process.env.SHELL = resolve(import.meta.dirname, 'bin/login-shell');
process.env.CLAUDE_CONFIG_DIR = join(home, 'claude');
process.env.CODEX_HOME = join(home, 'codex');
process.env.FAKE_GH_REGISTRY = ghRegistry;
process.env.FAKE_CODEX_REGISTRY = codexRegistry;
process.env.FAKE_EUNOE_REGISTRY = eunoeRegistry;
process.env.FAKE_MCP_REGISTRY = mcpRegistry;
process.env.FAKE_BUT_HOME = join(home, 'but');
mkdirSync(process.env.FAKE_BUT_HOME);
delete process.env.CODEX_EXECUTABLE;

function signal(pid: number, name: NodeJS.Signals | 0) {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

function readArgs(entry: string) {
  try {
    return readFileSync(entry, 'utf8');
  } catch {
    return null;
  }
}

function listRunning(registry: string) {
  return readdirSync(registry).flatMap((name) => {
    const entry = join(registry, name);
    const args = readArgs(entry);
    if (args !== null && signal(Number(name), 0)) return [{ pid: Number(name), args }];
    rmSync(entry, { force: true });
    return [];
  });
}

async function assertNoStray(registry: string, program: string) {
  const deadline = Date.now() + STRAY_GH_WAIT_MS;
  let running = listRunning(registry);
  while (running.length > 0 && Date.now() < deadline) {
    await Bun.sleep(10);
    running = listRunning(registry);
  }
  if (running.length === 0) return;
  for (const { pid } of running) {
    signal(-pid, 'SIGKILL');
    signal(pid, 'SIGKILL');
    rmSync(join(registry, String(pid)), { force: true });
  }
  const strays = running.map(({ pid, args }) => `${pid} (${program} ${args})`).join(', ');
  throw new Error(
    `A fake ${program} outlived its test: ${strays}. Stop the work that runs it, and wait for it, before the test ends.`
  );
}

async function assertNoStrays() {
  await assertNoStray(ghRegistry, 'gh');
  await assertNoStray(codexRegistry, 'codex');
  await assertNoStray(eunoeRegistry, 'eunoe');
  await assertNoStray(mcpRegistry, 'MCP stdio server');
}

afterEach(assertNoStrays);
afterAll(assertNoStrays);
