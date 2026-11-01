import { REMOTE_PATHS, type RemoteSession } from '@shinsa/core';

export const SHARE_GONE =
  'This task is no longer shared, or the link is wrong. Ask whoever sent it for a new one.';

export class ShareGoneError extends Error {
  constructor(message = SHARE_GONE) {
    super(message);
    this.name = 'ShareGoneError';
  }
}

export async function requestSharedText(url: string, read: typeof fetch = fetch) {
  const response = await read(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('The code did not load. Reload the page to try again.');
  return response.text();
}

export async function requestViewerLogin(read: typeof fetch = fetch) {
  try {
    const response = await read(REMOTE_PATHS.session);
    if (!response.ok) return null;
    return ((await response.json()) as RemoteSession).user?.login ?? null;
  } catch {
    return null;
  }
}
