import { Layer } from 'effect';
import { ShellLayer } from '../shell/layers.ts';
import { BrowserSignInCheck } from './check/service.ts';
import { BrowserCookies } from './cookies/service.ts';
import { BrowserHost } from './host/service.ts';
import { BrowserProxy } from './proxy/service.ts';

export const BrowserLayer = Layer.mergeAll(
  BrowserProxy.layer,
  BrowserSignInCheck.layer,
  BrowserCookies.layer.pipe(Layer.provide(ShellLayer))
).pipe(Layer.provideMerge(BrowserHost.layer));
