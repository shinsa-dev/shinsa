import { describeCount } from '@shinsa/core';
import type { BrowserCopyAnswer, BrowserSite, SourceBrowserAnswer } from '@shinsa/core/engine-api/schema';

export const BROWSER_SECTION = 'Browser';

export const BROWSER_DESCRIPTION =
  'Each project’s agents share one Chrome on this Mac. Sign it in once and every later task in that project starts signed in.';

export const COPY_DIALOG_TITLE = 'Copy sign-ins from your browser';

export const COPY_DIALOG_DESCRIPTION = 'Copies the sites you tick into this project’s shared browser.';

export const COPY_KEYCHAIN_HINT =
  'macOS asks once to let Shinsa use your browser’s key. Only the sites you tick are copied.';

export const SIGN_IN_WINDOW_NOTE =
  'The window has nothing automating it, so Google lets you sign in. Agents wait until you press Done.';

export const SIGN_OUT_TITLE = 'Sign out of everything?';

export const BROWSER_REMOTE_NOTE = 'Signing in happens on the Mac this task runs on. Open Shinsa there.';

const SHOWN_SITES = 3;

const COPY_REFUSING_SITES: ReadonlyArray<string> = ['google.com', 'youtube.com'];

export function describeSignOut(project: string) {
  return `Shinsa deletes ${project}’s browser profile, so its agents are signed out of every site.`;
}

export function describeSignedInSites(sites: ReadonlyArray<BrowserSite>) {
  const names = sites.filter((site) => site.signedIn).map((site) => site.site);
  if (names.length === 0) return 'Not signed in to any site yet';
  const shown = names.slice(0, SHOWN_SITES).join(', ');
  const rest = names.length - SHOWN_SITES;
  return rest > 0
    ? `Signed in to ${shown} and ${describeCount(rest, 'more', 'more')}`
    : `Signed in to ${shown}`;
}

export function describeCopyDone(answer: BrowserCopyAnswer) {
  const copied = `Copied ${describeCount(answer.copied, 'cookie')}.`;
  return answer.skipped > 0
    ? `${copied} Skipped ${describeCount(answer.skipped, 'expired one', 'expired ones')}.`
    : copied;
}

export function describeCopyButton(count: number) {
  return count === 0 ? 'Copy sites' : `Copy ${describeCount(count, 'site')}`;
}

export function describeCopyFrom(source: SourceBrowserAnswer | null) {
  return source ? `Copy from ${source.name}` : 'Copy from your browser';
}

export function describeNotInSource(site: string, source: SourceBrowserAnswer) {
  return `No ${site} sign-in in ${source.name}.`;
}

export function resolveDefaultSource(sources: ReadonlyArray<SourceBrowserAnswer>) {
  return sources.find((source) => source.isDefault) ?? sources[0] ?? null;
}

function isOnSite(host: string, site: string) {
  return host === site || host.endsWith(`.${site}`);
}

export function selectMatchingSite(host: string, sites: ReadonlyArray<BrowserSite>) {
  const name = host.toLowerCase();
  return (
    sites
      .filter((site) => site.signedIn && isOnSite(name, site.site))
      .sort((a, b) => b.site.length - a.site.length)[0] ?? null
  );
}

export function isCopyRefused(host: string) {
  const name = host.toLowerCase();
  return COPY_REFUSING_SITES.some((site) => isOnSite(name, site));
}

export function filterSites(sites: ReadonlyArray<BrowserSite>, query: string) {
  const needle = query.trim().toLowerCase();
  return needle ? sites.filter((site) => site.site.includes(needle)) : [...sites];
}

export function toggleSite(chosen: ReadonlySet<string>, site: string, on: boolean) {
  const next = new Set(chosen);
  if (on) next.add(site);
  else next.delete(site);
  return next;
}
