import type { Channel } from '../releases/schema.ts';

export interface Validators {
  readonly etag: string;
  readonly lastModified: string;
  readonly modifiedSeconds: number;
}

export const DMG_HEADERS = {
  'Content-Type': 'application/x-apple-diskimage',
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
};

export const VERSION_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export const CHANNEL_SUFFIXES: Record<string, Channel> = {
  '': 'stable',
  '/beta': 'beta',
  '/canary': 'canary',
};
