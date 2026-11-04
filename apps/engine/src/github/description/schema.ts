import type { EvidenceUpload } from '@shinsa/core';

export interface PullRequestDescription {
  readonly body: string;
  readonly uploads: EvidenceUpload[];
}

const MEGABYTE = 1024 * 1024;

const IMAGE_LIMIT_BYTES = 10 * MEGABYTE;

const VIDEO_LIMIT_BYTES = 100 * MEGABYTE;

export const ATTACHMENT_TYPES: Record<string, { contentType: string; limit: number }> = {
  '.png': { contentType: 'image/png', limit: IMAGE_LIMIT_BYTES },
  '.jpg': { contentType: 'image/jpeg', limit: IMAGE_LIMIT_BYTES },
  '.jpeg': { contentType: 'image/jpeg', limit: IMAGE_LIMIT_BYTES },
  '.gif': { contentType: 'image/gif', limit: IMAGE_LIMIT_BYTES },
  '.webp': { contentType: 'image/webp', limit: IMAGE_LIMIT_BYTES },
  '.mp4': { contentType: 'video/mp4', limit: VIDEO_LIMIT_BYTES },
  '.mov': { contentType: 'video/quicktime', limit: VIDEO_LIMIT_BYTES },
  '.webm': { contentType: 'video/webm', limit: VIDEO_LIMIT_BYTES },
};

export const REVIEW_LINK_LIMIT = 24_000;
