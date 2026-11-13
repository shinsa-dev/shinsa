import { CACHE_ORIGIN, type Channel, PRODUCTS, type Product, SHINSA } from '../releases/schema.ts';
import { CHANNEL_SUFFIXES } from './schema.ts';

export function resolveChannel(pathname: string): { product: Product; channel: Channel } | null {
  const path = pathname.replace(/\/+$/, '');
  for (const product of PRODUCTS) {
    if (!path.startsWith(product.downloadPath)) continue;
    const channel = CHANNEL_SUFFIXES[path.slice(product.downloadPath.length)];
    if (channel) return { product, channel };
  }
  return null;
}

export function resolveVersionChannel(pathname: string): Channel | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/download/version') return 'stable';
  if (path === '/download/version/beta') return 'beta';
  if (path === '/download/version/canary') return 'canary';
  return null;
}

export function resolveChannelKey(channel: Channel, product: Product = SHINSA) {
  return `${product.prefix}channels/${channel}.json`;
}

export function resolveReleaseKey(version: string, product: Product = SHINSA) {
  return `${product.prefix}releases/${version}/${product.dmgName}`;
}

export function resolvePointerCacheKey(channel: Channel, product: Product = SHINSA) {
  return `${CACHE_ORIGIN}/${resolveChannelKey(channel, product)}`;
}
