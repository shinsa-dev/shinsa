import { execFile } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type CommandLink,
  isOnPath,
  needsProfileEdit,
  parseLoginPath,
  planCommandLink,
  resolveCommandDir,
  resolveCommandLink,
  resolveLoginPathArgs,
  resolveProfileEdit,
  type Shell,
} from '../lib/command-line.ts';
import { resolveEngineProgram } from '../lib/engine.ts';

const LOGIN_SHELL_TIMEOUT_MS = 5000;

const SHELLS: { shell: Shell; programs: string[] }[] = [
  { shell: 'zsh', programs: ['/bin/zsh'] },
  { shell: 'bash', programs: ['/bin/bash'] },
  { shell: 'fish', programs: ['/opt/homebrew/bin/fish', '/usr/local/bin/fish'] },
];

function readCommandLink(path: string): CommandLink {
  try {
    if (!lstatSync(path).isSymbolicLink()) return { kind: 'file' };
    return { kind: 'link', target: readlinkSync(path) };
  } catch {
    return { kind: 'missing' };
  }
}

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readLoginPath(program: string, shell: Shell) {
  return new Promise<string | null>((resolve) => {
    execFile(
      program,
      resolveLoginPathArgs(shell),
      { timeout: LOGIN_SHELL_TIMEOUT_MS, env: { ...process.env, TERM: 'dumb' } },
      (error, stdout) => resolve(error ? null : parseLoginPath(stdout))
    );
  });
}

function isShellUsed(shell: Shell, home: string) {
  if (shell !== 'bash') return true;
  return existsSync(join(home, '.bash_profile')) || process.env.SHELL?.endsWith('/bash') === true;
}

function linkProgram(program: string, home: string) {
  const link = resolveCommandLink(home);
  const plan = planCommandLink(readCommandLink(link), program);
  if (plan === 'keep' || plan === 'leave') return plan;
  mkdirSync(dirname(link), { recursive: true });
  if (plan === 'replace') rmSync(link, { force: true });
  symlinkSync(program, link);
  return plan;
}

async function addToShellPaths(home: string) {
  const dir = resolveCommandDir(home);
  const added: Shell[] = [];
  for (const { shell, programs } of SHELLS) {
    const program = programs.find((candidate) => existsSync(candidate));
    if (!program || !isShellUsed(shell, home)) continue;
    const path = await readLoginPath(program, shell);
    if (path === null || isOnPath(path, dir)) continue;
    const edit = resolveProfileEdit(shell, home);
    if (!needsProfileEdit(readText(edit.file))) continue;
    mkdirSync(dirname(edit.file), { recursive: true });
    if (edit.mode === 'append') appendFileSync(edit.file, edit.text);
    else writeFileSync(edit.file, edit.text);
    added.push(shell);
  }
  return added;
}

export async function syncCommandLine() {
  const program = resolveEngineProgram(process.resourcesPath);
  if (!existsSync(program)) return null;
  const home = homedir();
  try {
    return { link: linkProgram(program, home), addedTo: await addToShellPaths(home) };
  } catch {
    return null;
  }
}
