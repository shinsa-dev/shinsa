import { PREVIEW_ACCESS_HEADER, PREVIEW_KEY_HEADER } from '@shinsa/core';
import { Duration } from 'effect';

export const PREVIEW_COOKIE = '__Host-shinsa_preview';

export const PREVIEW_ACCESS_COOKIE = '__Host-shinsa_preview_access';

export const PREVIEW_COOKIE_TTL = Duration.days(30);

export const PREVIEW_COOKIES = new Set([PREVIEW_COOKIE, PREVIEW_ACCESS_COOKIE]);

export const FORWARDED_AWAY = new Set(['cookie', PREVIEW_KEY_HEADER, PREVIEW_ACCESS_HEADER]);

export const BODILESS_METHODS = new Set(['GET', 'HEAD']);

export interface PreviewPass {
  readonly key: string | null;
  readonly access: string | null;
}
