import { Layer } from 'effect';
import { CloudConfig } from './config/service.ts';
import { CloudCrypto } from './crypto/service.ts';
import { Cloudflare } from './integrations/cloudflare/service.ts';
import { GitHub } from './integrations/github/service.ts';
import { OutboundHttp } from './integrations/http.ts';
import { Relays } from './integrations/relays/service.ts';
import { SlackApi } from './integrations/slack/service.ts';
import { StoreLayer } from './store/index.ts';

export const CloudServices = Layer.mergeAll(
  StoreLayer,
  CloudCrypto.layer,
  GitHub.layer,
  Cloudflare.layer,
  SlackApi.layer,
  Relays.layer
).pipe(Layer.provideMerge(CloudConfig.layer), Layer.provideMerge(OutboundHttp));
