import {
  resolveShareFilePath,
  resolveSharePath,
  resolveSharePreviewApiPath,
  type SharedPublication,
  type SharePreview,
} from '@shinsa/core';
import { requestJson } from '@/lib/connection/http.ts';
import type { SharedSource } from '@/lib/share/view.ts';

export const SHARE_GONE =
  'This task is no longer shared, or the link is wrong. Ask whoever sent it for a new one.';

export class ShareGoneError extends Error {
  constructor() {
    super(SHARE_GONE);
    this.name = 'ShareGoneError';
  }
}

export function createPreviewSource(preview: SharePreview): SharedSource {
  return {
    shared: preview.shared,
    updatedAt: preview.updatedAt,
    resolveFileUrl: (fileId) => preview.files[fileId] ?? null,
  };
}

export function createPublicationSource(publication: SharedPublication, token: string): SharedSource {
  const files = new Set(publication.files);
  return {
    shared: publication.shared,
    updatedAt: publication.updatedAt,
    resolveFileUrl: (fileId) => (files.has(fileId) ? resolveShareFilePath(token, fileId) : null),
  };
}

export async function requestPreviewSource(taskId: string) {
  return createPreviewSource(await requestJson<SharePreview>(resolveSharePreviewApiPath(taskId)));
}

export async function requestPublicationSource(token: string, read: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await read(resolveSharePath(token));
  } catch {
    throw new Error('Couldn’t reach app.shinsa.dev. Check your connection and reload the page.');
  }
  if (response.status === 404) throw new ShareGoneError();
  if (!response.ok)
    throw new Error(`app.shinsa.dev answered with status ${response.status}. Reload the page.`);
  return createPublicationSource((await response.json()) as SharedPublication, token);
}

export async function requestDiffText(url: string, read: typeof fetch = fetch) {
  const response = await read(url);
  if (!response.ok) throw new Error('The changes did not load. Reload the page to try again.');
  return response.text();
}
