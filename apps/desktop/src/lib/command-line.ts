export const SHELL_COMMAND_PATH = '/usr/local/bin/shinsa';

export type CommandLineInstall =
  | { kind: 'installed' }
  | { kind: 'missing' }
  | { kind: 'failed'; failure: string };

function quoteShell(text: string) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function quoteAppleScript(text: string) {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function resolveCommandLineScript(program: string) {
  const command = `mkdir -p /usr/local/bin && ln -sf ${quoteShell(program)} ${quoteShell(SHELL_COMMAND_PATH)}`;
  return `do shell script ${quoteAppleScript(command)} with prompt ${quoteAppleScript('Shinsa wants to install the shinsa command.')} with administrator privileges`;
}

export function describeCommandLineInstall(result: CommandLineInstall) {
  switch (result.kind) {
    case 'installed':
      return {
        type: 'info' as const,
        message: 'The shinsa command is installed',
        detail: 'Open a new terminal and run “shinsa .” in a repository to open Shinsa on its project.',
      };
    case 'missing':
      return {
        type: 'warning' as const,
        message: 'This build has no shinsa command',
        detail: 'Install Shinsa from shinsa.dev/download to get the command with it.',
      };
    case 'failed':
      return {
        type: 'warning' as const,
        message: 'The shinsa command was not installed',
        detail: result.failure,
      };
  }
}
