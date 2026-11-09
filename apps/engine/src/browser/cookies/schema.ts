import type { SourceBrowserId } from '@shinsa/core/engine-api/schema';
import { Duration, Schema } from 'effect';

export interface SourceBrowser {
  readonly id: SourceBrowserId;
  readonly name: string;
  readonly bundleId: string;
  readonly dataDir: string;
  readonly keychainService: string;
}

export const SOURCE_BROWSERS: ReadonlyArray<SourceBrowser> = [
  {
    id: 'dia',
    name: 'Dia',
    bundleId: 'company.thebrowser.dia',
    dataDir: 'Library/Application Support/Dia/User Data',
    keychainService: 'Dia Safe Storage',
  },
  {
    id: 'arc',
    name: 'Arc',
    bundleId: 'company.thebrowser.browser',
    dataDir: 'Library/Application Support/Arc/User Data',
    keychainService: 'Arc Safe Storage',
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    bundleId: 'com.google.chrome',
    dataDir: 'Library/Application Support/Google/Chrome',
    keychainService: 'Chrome Safe Storage',
  },
  {
    id: 'brave',
    name: 'Brave',
    bundleId: 'com.brave.browser',
    dataDir: 'Library/Application Support/BraveSoftware/Brave-Browser',
    keychainService: 'Brave Safe Storage',
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    bundleId: 'com.microsoft.edgemac',
    dataDir: 'Library/Application Support/Microsoft Edge',
    keychainService: 'Microsoft Edge Safe Storage',
  },
];

export const COOKIE_FILES: ReadonlyArray<string> = ['Default/Network/Cookies', 'Default/Cookies'];

export const COOKIE_FILE_COMPANIONS: ReadonlyArray<string> = ['-wal'];

export const LAUNCH_SERVICES_PLIST =
  'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist';

export const LaunchServicesHandlers = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      LSHandlerURLScheme: Schema.optional(Schema.String),
      LSHandlerRoleAll: Schema.optional(Schema.String),
    })
  )
);

export const CookieMetaRow = Schema.Struct({ value: Schema.String });

export const SiteCookieRow = Schema.Struct({
  hostKey: Schema.String,
  name: Schema.String,
  isHttponly: Schema.Number,
  samesite: Schema.Number,
});
export type SiteCookieRow = typeof SiteCookieRow.Type;

export const StoredCookieRow = Schema.Struct({
  hostKey: Schema.String,
  topFrameSiteKey: Schema.String,
  name: Schema.String,
  value: Schema.String,
  encryptedValue: Schema.Uint8Array,
  path: Schema.String,
  expiresUtc: Schema.Number,
  isSecure: Schema.Number,
  isHttponly: Schema.Number,
  isPersistent: Schema.Number,
  priority: Schema.Number,
  samesite: Schema.Number,
});
export type StoredCookieRow = typeof StoredCookieRow.Type;

export const CdpCookie = Schema.Struct({
  domain: Schema.String,
  name: Schema.String,
  path: Schema.String,
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  sameSite: Schema.optional(Schema.String),
  partitionKey: Schema.optional(Schema.Unknown),
});
export type CdpCookie = typeof CdpCookie.Type;

export const CdpCookies = Schema.Struct({ cookies: Schema.Array(CdpCookie) });

export interface CookieParam {
  readonly name: string;
  readonly value: string;
  readonly url?: string;
  readonly domain?: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  readonly expires: number;
  readonly priority: 'Low' | 'Medium' | 'High';
}

export const CookieSourceReason = Schema.Literals(['not_installed', 'unreadable']);

export class CookieSourceUnavailable extends Schema.TaggedError<
  CookieSourceUnavailable,
  { readonly brand: unique symbol }
>()('CookieSourceUnavailable', { reason: CookieSourceReason, message: Schema.String }) {}

export class KeychainRefused extends Schema.TaggedError<KeychainRefused, { readonly brand: unique symbol }>()(
  'KeychainRefused',
  { message: Schema.String }
) {}

export const COOKIE_SALT = 'saltysalt';

export const COOKIE_KEY_ITERATIONS = 1003;

export const COOKIE_KEY_BYTES = 16;

export const COOKIE_IV = Buffer.alloc(16, 0x20);

export const ENCRYPTED_PREFIX = 'v10';

export const HOST_DIGEST_BYTES = 32;

export const CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600;

export const EXPIRED_COOKIE_TIME = 1;

export const SESSION_COOKIE_LIFETIME = Duration.days(14);

export const COPY_BATCH = 200;

export const KEYCHAIN_TIMEOUT = Duration.minutes(2);

export const SAME_SITE: Readonly<Record<number, CookieParam['sameSite']>> = {
  0: 'None',
  1: 'Lax',
  2: 'Strict',
};

export const PRIORITY: Readonly<Record<number, CookieParam['priority']>> = {
  0: 'Low',
  1: 'Medium',
  2: 'High',
};

export const NOT_SIGN_IN_COOKIES: ReadonlySet<string> = new Set([
  '__cf_bm',
  '_cfuvid',
  'cf_clearance',
  '__cflb',
  'AWSALB',
  'AWSALBCORS',
  'AWSALBTG',
  'AWSALBTGCORS',
  'NID',
  'AEC',
]);

export interface SiteCookie {
  readonly host: string;
  readonly name: string;
  readonly httpOnly: boolean;
  readonly crossSite: boolean;
}

export const STORED_SAME_SITE_NONE = 0;

export const CDP_SAME_SITE_NONE = 'None';

export const MULTI_PART_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'co.jp',
  'co.nz',
  'com.br',
  'co.in',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'github.io',
  'herokuapp.com',
  'authkit.app',
  'fly.dev',
  'onrender.com',
  'web.app',
  'firebaseapp.com',
]);

export const SOURCE_NOT_INSTALLED_MESSAGE = 'That browser keeps no cookies on this Mac.';

export const SOURCE_UNREADABLE_MESSAGE = "That browser's cookies could not be read.";

export const KEYCHAIN_REFUSED_MESSAGE =
  "macOS did not allow Shinsa to use that browser's key, so nothing was copied. Copy again and choose Allow.";
