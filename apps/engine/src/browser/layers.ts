import { Layer } from 'effect';
import { BrowserHost } from './host/service.ts';
import { BrowserProxy } from './proxy/service.ts';

export const BrowserLayer = BrowserProxy.layer.pipe(Layer.provideMerge(BrowserHost.layer));
