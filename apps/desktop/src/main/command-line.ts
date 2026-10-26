import { execFile } from 'node:child_process';
import { existsSync, readlinkSync } from 'node:fs';
import { type BrowserWindow, dialog } from 'electron';
import {
  describeCommandLineInstall,
  resolveCommandLineScript,
  SHELL_COMMAND_PATH,
} from '../lib/command-line.ts';
import { resolveEngineProgram } from '../lib/engine.ts';

function readLink(path: string) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function runAsAdministrator(script: string) {
  return new Promise<string | null>((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script], (error, _stdout, stderr) =>
      resolve(error ? stderr.trim() || error.message : null)
    );
  });
}

export async function installCommandLine(win: BrowserWindow | null) {
  const program = resolveEngineProgram(process.resourcesPath);
  if (!existsSync(program)) {
    await dialog.showMessageBox({ ...describeCommandLineInstall({ kind: 'missing' }) });
    return;
  }
  if (readLink(SHELL_COMMAND_PATH) === program) {
    await dialog.showMessageBox({ ...describeCommandLineInstall({ kind: 'installed' }) });
    return;
  }
  const failure = await runAsAdministrator(resolveCommandLineScript(program));
  const view = describeCommandLineInstall(
    failure === null ? { kind: 'installed' } : { kind: 'failed', failure }
  );
  if (win) await dialog.showMessageBox(win, view);
  else await dialog.showMessageBox(view);
}
