import { APP_IDENTITY } from '@shinsa/core';

export const APP_NAME = APP_IDENTITY.appName;

export const DEV_BUNDLE_ID = 'studio.overclock.shinsa.dev';

export const DEV_BUNDLE_KEYS = {
  CFBundleName: APP_NAME,
  CFBundleDisplayName: APP_NAME,
  CFBundleIdentifier: DEV_BUNDLE_ID,
} as const;
