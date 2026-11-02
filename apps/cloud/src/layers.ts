import { Layer } from 'effect';
import { CloudConfig } from './config/config.ts';
import { CloudCrypto } from './crypto/crypto.ts';
import { Cloudflare } from './integrations/cloudflare.ts';
import { GitHub } from './integrations/github.ts';
import { OutboundHttp } from './integrations/http.ts';
import { SlackApi } from './integrations/slack.ts';
import { Tunnels } from './integrations/tunnels.ts';
import { StoreLayer } from './store/index.ts';

export const CloudServices = Layer.mergeAll(
  StoreLayer,
  CloudCrypto.layer,
  GitHub.layer,
  Cloudflare.layer,
  SlackApi.layer,
  Tunnels.layer
).pipe(Layer.provideMerge(CloudConfig.layer), Layer.provideMerge(OutboundHttp));
