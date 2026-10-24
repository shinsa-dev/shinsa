type Env = Record<string, string | undefined>;

export const START_COMMANDS = ['shinsa service restart', 'shinsa service install'] as const;

const OUTPUT_LINES = 6;

export function resolveLoginShell(env: Env) {
  return env.SHELL?.startsWith('/') ? env.SHELL : '/bin/zsh';
}

export function summarizeOutput(output: string) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-OUTPUT_LINES)
    .join('\n');
}

export function describeWaiting(packaged: boolean) {
  return packaged
    ? 'Start it as a background service with “shinsa service install”, or restart it with “shinsa service restart”.'
    : 'Start the dev servers with “bun dev” in the checkout.';
}
