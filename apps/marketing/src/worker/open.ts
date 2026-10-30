import { resolveDocumentTitle, resolveTaskInvite } from '../lib/open.ts';

export const OPEN_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};

export function isOpenPage(pathname: string) {
  return pathname.replace(/\/+$/, '') === '/open';
}

function rewriteOpenPage(response: Response, search: string) {
  const documentTitle = resolveDocumentTitle(resolveTaskInvite(search));
  const rewriter = new HTMLRewriter().on('title', {
    element: (element) => {
      if (documentTitle) element.setInnerContent(documentTitle);
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
