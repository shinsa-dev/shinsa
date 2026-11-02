import { join } from 'node:path';
import {
  CLOUDFLARED_RELEASES,
  CLOUDFLARED_VERSION,
  type CloudflaredAsset,
  PINNED_CLOUDFLARED,
} from './schema.ts';

export function resolveCloudflaredAsset(platform: string, arch: string): CloudflaredAsset | null {
  const pinned = PINNED_CLOUDFLARED[`${platform}-${arch}`];
  if (!pinned) return null;
  return {
    version: CLOUDFLARED_VERSION,
    url: `${CLOUDFLARED_RELEASES}/${pinned.file}`,
    sha256: pinned.sha256,
    archive: pinned.file.endsWith('.tgz'),
  };
}

export function resolveCloudflaredPath(dataDir: string, asset: CloudflaredAsset) {
  return join(dataDir, 'bin', `cloudflared-${asset.version}`);
}
