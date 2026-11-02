import { Context, Duration, Schema } from 'effect';

export const CLOUDFLARED_VERSION = '2026.10.6';

export const CLOUDFLARED_RELEASES = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

export const PINNED_CLOUDFLARED: Readonly<
  Record<string, { readonly file: string; readonly sha256: string }>
> = {
  'darwin-arm64': {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: 'ea1e5105d35bbe16cee5b2f7b4742059ada341fbd35938ed827c24b85efa51c8',
  },
  'darwin-x64': {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: '6c04a13835ca5ff29a0c6f58d17d1f3956aad1b7df1631f5b5efbc06269deded',
  },
  'linux-arm64': {
    file: 'cloudflared-linux-arm64',
    sha256: '0ae0e179475b2c77651a718d2b376e0151f4fca5954702a84f02843a4d5fcac0',
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: '1d356dac769d0dbf62ebe588c4034824bbff98d5790c2f844cc99e0e2f57462d',
  },
};

export const DOWNLOAD_TIMEOUT = '2 minutes';

export const UNPACK_TIMEOUT = Duration.seconds(30);

export const CloudflaredAsset = Schema.Struct({
  version: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  archive: Schema.Boolean,
});
export type CloudflaredAsset = typeof CloudflaredAsset.Type;

export class CloudflaredUnsupported extends Schema.TaggedError<
  CloudflaredUnsupported,
  { readonly brand: unique symbol }
>()('CloudflaredUnsupported', { message: Schema.String }) {}

export class CloudflaredInstallFailed extends Schema.TaggedError<
  CloudflaredInstallFailed,
  { readonly brand: unique symbol }
>()('CloudflaredInstallFailed', { message: Schema.String }) {}

export const UNSUPPORTED_MESSAGE = 'Remote access needs cloudflared, which has no build for this computer.';

export class CloudflaredTarget extends Context.Service<
  CloudflaredTarget,
  { readonly dataDir: string; readonly asset: CloudflaredAsset | null }
>()('shinsa/engine/remote/cloudflared/CloudflaredTarget') {}
