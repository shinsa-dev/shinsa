import { describe, expect, it } from 'bun:test';
import { openTask } from '../../src/lib/content.ts';
import { isOpenPage, OPEN_HEADERS, respondOpen } from '../../src/worker/open.ts';

const PAGE = [
  '<html><head><title>Open a task · Shinsa</title></head><body>',
  '<h1><span data-open-title></span></h1>',
  '<p data-open-description></p>',
  '<a href="/download" data-open-task-only>Download Shinsa</a>',
  '<a href="/download" data-open-missing-only hidden="">Download Shinsa</a>',
  '<a href="shinsa://" data-open-link data-open-task-only>Open in Shinsa</a>',
  '</body></html>',
].join('');

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
  it('writes the task from the link into the page before it is sent', async () => {
    const { assets, requests } = serveAssets();
    const url = 'https://shinsa.dev/open?task=id-1&handle=LOC-28&title=Fix+%3Cb%3Etabs%3C%2Fb%3E';
    const response = await respondOpen(new Request(url), assets);
    const html = await response.text();
    expect(requests).toEqual([url]);
    expect(html).toContain('<title>LOC-28: Fix &lt;b&gt;tabs&lt;/b&gt; · Shinsa</title>');
    expect(html).toContain('<span data-open-title>Fix &lt;b&gt;tabs&lt;/b&gt;</span>');
    expect(html).toContain('<a href="shinsa://task/id-1" data-open-link data-open-task-only>');
    expect(html).toContain('<a href="/download" data-open-task-only>');
    expect(html).toContain('<a href="/download" data-open-missing-only hidden="">');
    expect(html).toContain('<p data-open-description></p>');
    for (const [name, value] of Object.entries(OPEN_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('hides Open in Shinsa and says why when the link names no task', async () => {
    const { assets } = serveAssets();
    const html = await (await respondOpen(new Request('https://shinsa.dev/open?task=../x'), assets)).text();
    expect(html).toContain('<title>Open a task · Shinsa</title>');
    expect(html).toContain(`<span data-open-title>${openTask.missingTitle}</span>`);
    expect(html).toContain(`<p data-open-description>${openTask.missing}</p>`);
    expect(html).toContain('<a href="shinsa://" data-open-link data-open-task-only hidden="">');
    expect(html).toContain('<a href="/download" data-open-task-only hidden="">');
    expect(html).toContain('<a href="/download" data-open-missing-only>');
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
