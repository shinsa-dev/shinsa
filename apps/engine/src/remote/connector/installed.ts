import { BunServices } from '@effect/platform-bun';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Shell } from '../../shell/service.ts';
import { resolveCloudflaredAsset } from '../cloudflared/asset.ts';
import { CloudflaredTarget } from '../cloudflared/schema.ts';
import { Cloudflared } from '../cloudflared/service.ts';
import { TunnelConnector } from './service.ts';

export function createInstalledConnector(
  dataDir: string,
  platform: string = process.platform,
  arch: string = process.arch
) {
  return TunnelConnector.cloudflared.pipe(
    Layer.provide(Cloudflared.layer),
    Layer.provide(
      Layer.succeed(CloudflaredTarget, { dataDir, asset: resolveCloudflaredAsset(platform, arch) })
    ),
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, Shell.layer)),
    Layer.provide(BunServices.layer)
  );
}
