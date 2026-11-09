import type { BrowserSite } from '@shinsa/core/engine-api/schema';
import { MULTI_PART_SUFFIXES, NOT_SIGN_IN_COOKIES, type SiteCookie } from './schema.ts';

export function resolveSite(hostKey: string) {
  const host = hostKey.replace(/^\./, '').toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function listBrowserSites(cookies: ReadonlyArray<SiteCookie>) {
  const bySite = new Map<string, { cookies: number; signedIn: boolean }>();
  for (const cookie of cookies) {
    const site = resolveSite(cookie.host);
    const current = bySite.get(site) ?? { cookies: 0, signedIn: false };
    bySite.set(site, {
      cookies: current.cookies + 1,
      signedIn: current.signedIn || (cookie.httpOnly && !NOT_SIGN_IN_COOKIES.has(cookie.name)),
    });
  }
  return [...bySite.entries()]
    .map(([site, summary]): BrowserSite => ({ site, ...summary }))
    .sort(
      (a, b) =>
        Number(b.signedIn) - Number(a.signedIn) || b.cookies - a.cookies || a.site.localeCompare(b.site)
    );
}

export function isOnSites(hostKey: string, sites: ReadonlySet<string>) {
  return sites.has(resolveSite(hostKey));
}
