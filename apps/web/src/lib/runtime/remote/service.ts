import { PageSession, RemoteApi } from '@shinsa/core/remote/api';
import { Context, Effect, Layer, Option } from 'effect';
import { HttpClient, type HttpClientResponse, HttpIncomingMessage } from 'effect/http';
import { HttpApiClient, HttpApiMiddleware } from 'effect/http-api';
import {
  CLOUD_ANSWER_UNREADABLE_MESSAGE,
  CLOUD_FAILED_CODE,
  CLOUD_UNREACHABLE_MESSAGE,
  CloudAnswerInvalid,
  CloudErrorBody,
  CloudRefused,
  CloudUnreachable,
  type RemotePageGroup,
} from './schema.ts';

export class RemoteClient extends Context.Service<
  RemoteClient,
  {
    readonly session: RemotePageGroup<'session'>;
    readonly pairs: RemotePageGroup<'pairs'>;
    readonly instances: RemotePageGroup<'instances'>;
    readonly shares: RemotePageGroup<'shares'>;
    readonly teams: RemotePageGroup<'teams'>;
  }
>()('shinsa/web/runtime/remote/RemoteClient') {
  static readonly layer = Layer.effect(
    RemoteClient,
    Effect.gen(function* () {
      const decodeRefusal = HttpIncomingMessage.schemaBodyJson(CloudErrorBody);
      const unreachable = new CloudUnreachable({ message: CLOUD_UNREACHABLE_MESSAGE });
      const unreadable = new CloudAnswerInvalid({ message: CLOUD_ANSWER_UNREADABLE_MESSAGE });
      const refuse = (response: HttpClientResponse.HttpClientResponse) =>
        decodeRefusal(response).pipe(
          Effect.option,
          Effect.flatMap((body) => {
            const error = Option.getOrUndefined(body)?.error;
            return Effect.fail(
              new CloudRefused({
                status: response.status,
                code: error?.code ?? CLOUD_FAILED_CODE,
                message: error?.message ?? `Shinsa Cloud answered ${response.status}.`,
              })
            );
          })
        );
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.transform(
          Effect.fnUntraced(function* (sent) {
            const response = yield* Effect.mapError(sent, () => unreachable);
            if (response.status < 400) return response;
            return yield* refuse(response);
          })
        )
      );
      const options = {
        httpClient,
        transformResponse: Effect.mapError(() => unreadable),
      };
      const page = HttpApiMiddleware.layerClient(PageSession, ({ request, next }) => next(request));
      const session = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'session' });
      const shares = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'shares' });
      const pairs = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'pairs' }).pipe(
        Effect.provide(page)
      );
      const instances = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'instances' }).pipe(
        Effect.provide(page)
      );
      const teams = yield* HttpApiClient.group(RemoteApi, { ...options, group: 'teams' }).pipe(
        Effect.provide(page)
      );
      return RemoteClient.of({ session, pairs, instances, shares, teams });
    })
  );
}
