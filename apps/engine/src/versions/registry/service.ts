import { Context, Duration, Effect, Layer, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  NPM_REGISTRY_URL,
  NpmLatest,
  NpmLatestText,
  NpmRegistryFailed,
  REGISTRY_TIMEOUT,
} from '../schema.ts';

export class NpmRegistry extends Context.Service<
  NpmRegistry,
  { latest(name: string): Effect.Effect<string, NpmRegistryFailed> }
>()('shinsa/engine/versions/registry/NpmRegistry') {
  static readonly layer = Layer.effect(
    NpmRegistry,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const decodeText = Schema.decodeUnknownEffect(NpmLatestText);
      const isLatest = Schema.is(NpmLatest);

      const latest = Effect.fn('NpmRegistry.latest')(function* (name: string) {
        const failed = (message: string) => new NpmRegistryFailed({ packageName: name, message });
        const response = yield* HttpClientRequest.get(`${NPM_REGISTRY_URL}/${name}/latest`).pipe(
          HttpClientRequest.acceptJson,
          client.execute,
          Effect.timeoutOrElse({
            duration: REGISTRY_TIMEOUT,
            orElse: () =>
              Effect.fail(
                failed(
                  `The npm registry gave no answer for ${name} within ${Duration.format(REGISTRY_TIMEOUT)}.`
                )
              ),
          }),
          Effect.catchTag('HttpClientError', (error) =>
            Effect.fail(failed(`The npm registry could not be reached for ${name}: ${error.message}`))
          )
        );
        if (response.status < 200 || response.status >= 300) {
          return yield* failed(`The npm registry answered ${response.status} for ${name}.`);
        }
        const noVersion = failed(`The npm registry gave no version for ${name}.`);
        const body = yield* response.text.pipe(
          Effect.flatMap(decodeText),
          Effect.mapError(() => noVersion)
        );
        if (!isLatest(body)) return yield* noVersion;
        return body.version;
      });

      return NpmRegistry.of({ latest });
    })
  );
}
