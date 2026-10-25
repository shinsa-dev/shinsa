export const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking'; manual: boolean }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'current' }
  | { status: 'failed'; message: string };

export interface UpdateMenuItem {
  label: string;
  enabled: boolean;
  install: boolean;
}

export function isUpdateSupported({ packaged, platform }: { packaged: boolean; platform: string }) {
  return packaged && platform === 'darwin';
}

export function describeUpdateItem(state: UpdateState): UpdateMenuItem {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking for Updates…', enabled: false, install: false };
    case 'downloading':
      return {
        label: `Downloading Shinsa ${state.version}… ${Math.floor(state.percent)}%`,
        enabled: false,
        install: false,
      };
    case 'ready':
      return { label: `Restart to Update to ${state.version}`, enabled: true, install: true };
    default:
      return { label: 'Check for Updates…', enabled: true, install: false };
  }
}

export function describeReadyNotice(version: string) {
  return {
    title: `Shinsa ${version} is ready`,
    body: 'It installs the next time you quit Shinsa, or restart now from the Shinsa menu. Agents keep working either way.',
  };
}

export function describeManualResult(state: UpdateState, current: string) {
  switch (state.status) {
    case 'current':
      return { message: 'Shinsa is up to date', detail: `You have Shinsa ${current}, the latest version.` };
    case 'failed':
      return { message: 'Shinsa could not check for updates', detail: state.message };
    default:
      return null;
  }
}

export function describeUpdateFailure(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine || 'The update server did not answer. Try again later.';
}
