import { resolvePendingHeader } from '../lib/open.ts';

export const OPEN_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};

export function isOpenPage(pathname: string) {
  return pathname.replace(/\/+$/, '') === '/open';
}

export function rewriteOpenPage(response: Response, search: string) {
  const header = resolvePendingHeader(search);
  const rewriter = new HTMLRewriter()
    .on('[data-open-title]', { element: (element) => void element.setInnerContent(header.title) })
    .on('[data-open-description]', { element: (element) => void element.setInnerContent(header.description) })
    .on('[data-open-handle]', { element: (element) => void element.setInnerContent(header.handle) })
    .on('[data-open-link]', {
      element: (element) => {
        if (header.link) element.setAttribute('href', header.link);
        else element.setAttribute('hidden', '');
      },
    })
    .on('title', {
      element: (element) => {
        if (header.documentTitle) element.setInnerContent(header.documentTitle);
      },
    });
  const rewritten = rewriter.transform(response);
  const headers = new Headers(rewritten.headers);
  for (const [name, value] of Object.entries(OPEN_HEADERS)) headers.set(name, value);
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

export async function respondOpen(request: Request, assets: (request: Request) => Promise<Response>) {
  const response = await assets(request);
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  return rewriteOpenPage(response, new URL(request.url).search);
}
