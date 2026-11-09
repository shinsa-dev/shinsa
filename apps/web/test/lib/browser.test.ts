import { describe, expect, it } from 'bun:test';
import {
  describeCopyButton,
  describeCopyDone,
  describeCopyFrom,
  describeNotInSource,
  describeRemoveSite,
  describeSiteCookies,
  describeSiteRemoved,
  describeSignOut,
  filterSites,
  isCopyRefused,
  listSignedInSites,
  resolveDefaultSource,
  selectMatchingSite,
  toggleSite,
  resolveFaviconUrl,
} from '@/lib/browser.ts';

const site = (name: string, signedIn = true) => ({ site: name, cookies: 1, signedIn });

const DIA = { id: 'dia' as const, name: 'Dia', isDefault: true };

const CHROME = { id: 'chrome' as const, name: 'Chrome', isDefault: false };

describe('the signed-in sites', () => {
  it('keeps only the sites signed in and counts their cookies', () => {
    expect(listSignedInSites([site('a.com'), site('ads.net', false)])).toEqual([site('a.com')]);
    expect(describeSiteCookies({ site: 'a.com', cookies: 12, signedIn: true })).toBe('12 cookies');
    expect(describeSiteCookies(site('a.com'))).toBe('1 cookie');
  });
});

describe('one site', () => {
  it('names its remove button and its toast', () => {
    expect(describeRemoveSite('github.com')).toBe('Sign out of github.com');
    expect(describeSiteRemoved('github.com')).toBe('Signed out of github.com.');
  });

  it('loads a favicon from the site itself, and none for a local address', () => {
    expect(resolveFaviconUrl('github.com')).toBe('https://github.com/favicon.ico');
    for (const site of ['localhost', '127.0.0.1', '[::1]', 'intranet'])
      expect(resolveFaviconUrl(site)).toBeNull();
  });
});

describe('the copy words', () => {
  it('says what was copied and what was skipped', () => {
    expect(describeCopyDone({ copied: 1, skipped: 0, sites: [] })).toBe('Copied 1 cookie.');
    expect(describeCopyDone({ copied: 40, skipped: 2, sites: [] })).toBe(
      'Copied 40 cookies. Skipped 2 expired ones.'
    );
  });

  it('labels the copy button by how many sites are ticked', () => {
    expect(describeCopyButton(0)).toBe('Copy sites');
    expect(describeCopyButton(1)).toBe('Copy 1 site');
    expect(describeCopyButton(3)).toBe('Copy 3 sites');
  });

  it('names the browser it copies from', () => {
    expect(describeCopyFrom(DIA)).toBe('Copy from Dia');
    expect(describeCopyFrom(null)).toBe('Copy from your browser');
    expect(describeNotInSource('linear.app', DIA)).toBe('No linear.app sign-in in Dia.');
    expect(describeSignOut('Superwall')).toBe(
      'Shinsa deletes Superwall’s browser profile, so its agents are signed out of every site.'
    );
  });
});

describe('resolveDefaultSource', () => {
  it('takes your default browser, else the first, else none', () => {
    expect(resolveDefaultSource([CHROME, DIA])).toBe(DIA);
    expect(resolveDefaultSource([CHROME])).toBe(CHROME);
    expect(resolveDefaultSource([])).toBeNull();
  });
});

describe('selectMatchingSite', () => {
  it('finds the most specific site a host belongs to', () => {
    const sites = [site('vercel.app'), site('my-app.vercel.app'), site('stripe.com')];
    expect(selectMatchingSite('App.Stripe.com', sites)?.site).toBe('stripe.com');
    expect(selectMatchingSite('my-app.vercel.app', sites)?.site).toBe('my-app.vercel.app');
    expect(selectMatchingSite('stripe.com.net', sites)).toBeNull();
  });

  it('skips a site your browser only has tracking cookies for', () => {
    const sites = [site('workos.com', false), site('dashboard.workos.com', false)];
    expect(selectMatchingSite('dashboard.workos.com', sites)).toBeNull();
  });
});

describe('isCopyRefused', () => {
  it('marks Google’s sites, whose sessions do not copy', () => {
    expect(isCopyRefused('accounts.google.com')).toBe(true);
    expect(isCopyRefused('YouTube.com')).toBe(true);
    expect(isCopyRefused('google.com.evil.dev')).toBe(false);
    expect(isCopyRefused('github.com')).toBe(false);
  });
});

describe('the site list', () => {
  it('filters by what you type and ticks sites on and off', () => {
    const sites = [site('github.com'), site('gitlab.com'), site('vercel.com')];
    expect(filterSites(sites, ' GIT').map((entry) => entry.site)).toEqual(['github.com', 'gitlab.com']);
    expect(filterSites(sites, '  ')).toEqual(sites);
    const on = toggleSite(new Set(), 'github.com', true);
    expect([...on]).toEqual(['github.com']);
    expect([...toggleSite(on, 'github.com', false)]).toEqual([]);
  });
});
