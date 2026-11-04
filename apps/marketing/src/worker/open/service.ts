import { Context, Effect, Layer } from 'effect';
import { resolveDocumentTitle, resolveTaskInvite } from '../../lib/open.ts';
import { Assets } from '../assets/service.ts';
import { OPEN_HEADERS } from './schema.ts';

export class OpenPage extends Context.Service<
  OpenPage,
  { respond(request: Request): Effect.Effect<Response> }
>()('shinsa/marketing/worker/open/OpenPage') {
  static readonly layer = Layer.effect(
    OpenPage,
    Effect.gen(function* () {
      const assets = yield* Assets;

      const rewriteOpenPage = (response: Response, search: string) => {
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
      };

      const respond = Effect.fn('OpenPage.respond')(function* (request: Request) {
        const response = yield* assets.fetch(request);
        if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
        return rewriteOpenPage(response, new URL(request.url).search);
      });

      return OpenPage.of({ respond });
    })
  );
}
