import type { SharedTask } from '../share/index.ts';
import { parseBase64Url } from './bytes.ts';
import { REMOTE_PATHS } from './contract.ts';

export const SHARE_DIFF_FILE = 'diff';

export const SHARE_CODE_FILE = 'code';

export const SHARE_ID_BYTES = 16;

export const SHARE_KEY_BYTES = 32;

export const SHARE_CHANNEL_PATH = '/share';

export const SHARE_CHANNEL_PARAM = 'id';

export const SHARE_FILE_BYTES = 50 * 1024 * 1024;

export const SHARE_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'text/plain',
] as const;

export type ShareFileType = (typeof SHARE_FILE_TYPES)[number];

export interface ShareLink {
  instanceId: string;
  shareId: string;
  key: string;
}

export interface ShareFile {
  version: string;
  type: ShareFileType;
}

export interface ShareLiveView {
  shared: SharedTask;
  files: Record<string, ShareFile>;
  updatedAt: number;
}

export interface SharePreview {
  shared: SharedTask;
  files: Record<string, string>;
  updatedAt: number;
}

export interface ShareConnectResponse {
  url: string;
  online: boolean;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

const SHARE_PAGE = new RegExp(`^${REMOTE_PATHS.sharePage}/([A-Za-z0-9_-]+)/([A-Za-z0-9_-]+)$`);

function hasBytes(text: string, length: number) {
  return parseBase64Url(text)?.length === length;
}

export function serializeShareUrl(origin: string, link: ShareLink) {
  return `${origin}${resolveSharePagePath(link.instanceId, link.shareId)}#${link.key}`;
}

export function resolveSharePagePath(instanceId: string, shareId: string) {
  return `${REMOTE_PATHS.sharePage}/${encodeURIComponent(instanceId)}/${encodeURIComponent(shareId)}`;
}

export function parseShareLocation(pathname: string, hash: string): ShareLink | null {
  const page = SHARE_PAGE.exec(pathname);
  const key = hash.replace(/^#/, '');
  if (!(page?.[1] && page[2]) || !hasBytes(page[2], SHARE_ID_BYTES) || !hasBytes(key, SHARE_KEY_BYTES))
    return null;
  return { instanceId: page[1], shareId: page[2], key };
}

export function parseShareUrl(url: string | null): ShareLink | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parseShareLocation(parsed.pathname, parsed.hash);
  } catch {
    return null;
  }
}

export function isShareId(value: string) {
  return SEGMENT.test(value) && hasBytes(value, SHARE_ID_BYTES);
}

export function resolveShareConnectPath(instanceId: string) {
  return `${REMOTE_PATHS.shares}/${encodeURIComponent(instanceId)}/connect`;
}

export function resolveShareChannelUrl(tunnelUrl: string, shareId: string) {
  return `${tunnelUrl}${SHARE_CHANNEL_PATH}?${SHARE_CHANNEL_PARAM}=${encodeURIComponent(shareId)}`;
}

export function resolveSharePreviewApiPath(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}/share/preview`;
}

export function resolveSharePreviewDiffApiPath(taskId: string) {
  return `${resolveSharePreviewApiPath(taskId)}/diff`;
}

export function resolveSharePreviewCodeApiPath(taskId: string) {
  return `${resolveSharePreviewApiPath(taskId)}/code`;
}
