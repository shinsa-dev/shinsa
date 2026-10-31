import type { SharedTask } from '../share/index.ts';
import { REMOTE_PATHS } from './contract.ts';

export const SHARE_DIFF_FILE = 'diff';

export const SHARE_CODE_FILE = 'code';

const SHARE_CODE_IDS: ReadonlySet<string> = new Set([SHARE_DIFF_FILE, SHARE_CODE_FILE]);

export const PUBLICATION_LIMITS = {
  bytes: 1024 * 1024,
  files: 200,
  fileBytes: 50 * 1024 * 1024,
  checkHashes: 200,
} as const;

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

const SHARE_FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface PublicationFile {
  id: string;
  hash: string;
}

export interface PublicationRequest {
  shared: SharedTask;
  files: PublicationFile[];
  newLink: boolean;
}

export interface PublicationResponse {
  url: string | null;
}

export interface FilesCheckRequest {
  hashes: string[];
}

export interface FilesCheckResponse {
  missing: string[];
}

export interface SharedPublication {
  shared: SharedTask;
  files: string[];
  updatedAt: number;
}

export interface SharePreview {
  shared: SharedTask;
  files: Record<string, string>;
  updatedAt: number;
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

export function isShareCodeFile(fileId: string) {
  return SHARE_CODE_IDS.has(fileId);
}

export function isShareFileType(value: string): value is ShareFileType {
  return (SHARE_FILE_TYPES as readonly string[]).includes(value);
}

export function isShareFileId(value: string) {
  return SHARE_FILE_ID.test(value);
}

export function resolveMachinePublicationPath(taskId: string) {
  return `${REMOTE_PATHS.machinePublications}/${encodeURIComponent(taskId)}`;
}

export function resolveMachinePublicationRemovePath(taskId: string) {
  return `${resolveMachinePublicationPath(taskId)}/remove`;
}

export function resolveMachineFilePath(hash: string) {
  return `${REMOTE_PATHS.machineFiles}/${encodeURIComponent(hash)}`;
}

export function resolveSharePagePath(token: string) {
  return `${REMOTE_PATHS.sharePage}/${encodeURIComponent(token)}`;
}

export function resolveShareUrl(origin: string, token: string) {
  return `${origin}${resolveSharePagePath(token)}`;
}

export function resolveSharePath(token: string) {
  return `${REMOTE_PATHS.shares}/${encodeURIComponent(token)}`;
}

export function resolveShareFilePath(token: string, fileId: string) {
  return `${resolveSharePath(token)}/files/${encodeURIComponent(fileId)}`;
}
