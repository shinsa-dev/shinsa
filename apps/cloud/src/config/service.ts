import { type Config, Context, Layer } from 'effect';
import { CLOUD_CONFIG } from './schema.ts';

export class CloudConfig extends Context.Service<CloudConfig, Config.Success<typeof CLOUD_CONFIG>>()(
  'shinsa/cloud/config/CloudConfig'
) {
  static readonly layer = Layer.effect(CloudConfig, CLOUD_CONFIG);
}
