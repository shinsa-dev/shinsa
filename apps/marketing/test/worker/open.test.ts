import { describe, expect, it } from 'bun:test';
import { isOpenPage, OPEN_HEADERS, respondOpen } from '../../src/worker/open.ts';

const BODY = '<astro-island><div><svg data-slot="spinner" role="status"></svg></div></astro-island>';

const PAGE = `<html><head><title>Open a task · Shinsa</title></head><body>${BODY}</body></html>`;

function serveAssets(
  body = PAGE,
  init: ResponseInit = { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
) {
  const requests: string[] = [];
  const assets = async (request: Request) => {
    requests.push(request.url);
    return new Response(body, init);
  };
  return { assets, requests };
}

describe('isOpenPage', () => {
  it('matches the open page with or without a trailing slash and nothing else', () => {
    expect(isOpenPage('/open')).toBe(true);
    expect(isOpenPage('/open/')).toBe(true);
    expect(isOpenPage('/opener')).toBe(false);
    expect(isOpenPage('/download')).toBe(false);
  });
});

describe('respondOpen', () => {
  it('names the tab after the task in the link and leaves the page to the browser', async () => {
    const { assets, requests } = serveAssets();
    const url = 'https://shinsa.dev/open?task=id-1&handle=LOC-28&title=Fix+%3Cb%3Etabs%3C%2Fb%3E';
    const response = await respondOpen(new Request(url), assets);
    const html = await response.text();
    expect(requests).toEqual([url]);
    expect(html).toBe(
      `<html><head><title>LOC-28: Fix &lt;b&gt;tabs&lt;/b&gt; · Shinsa</title></head><body>${BODY}</body></html>`
    );
    for (const [name, value] of Object.entries(OPEN_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('keeps the page as built when the link names no task', async () => {
    const { assets } = serveAssets();
    const response = await respondOpen(new Request('https://shinsa.dev/open?task=../x'), assets);
    expect(await response.text()).toBe(PAGE);
    for (const [name, value] of Object.entries(OPEN_HEADERS)) expect(response.headers.get(name)).toBe(value);
  });

  it('passes through a response that is not the page', async () => {
    const notModified = serveAssets('', { status: 304 });
    const unchanged = await respondOpen(new Request('https://shinsa.dev/open?task=id-1'), notModified.assets);
    expect(unchanged.status).toBe(304);
    const text = serveAssets('plain', { headers: { 'Content-Type': 'text/plain' } });
    expect(await (await respondOpen(new Request('https://shinsa.dev/open'), text.assets)).text()).toBe(
      'plain'
    );
  });
});
