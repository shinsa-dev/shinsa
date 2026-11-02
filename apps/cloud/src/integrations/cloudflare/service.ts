import { CloudflareFailed } from '@shinsa/core/remote/errors';
import { Context, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { CloudConfig } from '../../config/service.ts';
import { CLOUDFLARE_API, type CloudflareMethod, type CreatedTunnel, Envelope, Identified } from './schema.ts';

export class Cloudflare extends Context.Service<
  Cloudflare,
  {
    createTunnel(
      name: string,
      hostname: string,
      localUrl: string
    ): Effect.Effect<CreatedTunnel, CloudflareFailed>;
    updateIngress(
      tunnelId: string,
      hostname: string,
      localUrl: string
    ): Effect.Effect<void, CloudflareFailed>;
    removeTunnel(tunnelId: string, dnsRecordId: string): Effect.Effect<void, CloudflareFailed>;
  }
>()('shinsa/cloud/integrations/Cloudflare') {
  static readonly layer = Layer.effect(
    Cloudflare,
    Effect.gen(function* () {
      const config = yield* CloudConfig;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.bearerToken(config.cloudflareApiToken))
      );
      const zoneId = yield* Ref.make(Option.none<string>());
      const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
      const account = `/accounts/${config.cloudflareAccountId}`;

      const call = Effect.fn('Cloudflare.call')(function* <A, I>(
        method: CloudflareMethod,
        path: string,
        Result: Schema.Codec<A, I>,
        body?: unknown
      ) {
        const refuse = (detail: string) =>
          new CloudflareFailed({ message: `Cloudflare refused ${method} ${path}: ${detail}.` });
        const request = HttpClientRequest.make(method)(`${CLOUDFLARE_API}${path}`);
        const response = yield* client
          .execute(body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body))
          .pipe(Effect.mapError(() => refuse('unreachable')));
        const answer = decodeEnvelope(yield* Effect.orElseSucceed(response.json, () => null));
        if (response.status >= 300 || Option.isNone(answer) || !answer.value.success)
          return yield* refuse(
            Option.flatMapNullishOr(answer, (envelope) => envelope.errors?.[0]?.message).pipe(
              Option.getOrElse(() => `status ${response.status}`)
            )
          );
        return yield* Schema.decodeUnknownEffect(Result)(answer.value.result).pipe(
          Effect.mapError(() => refuse('an answer it could not read'))
        );
      });

      const resolveZoneId = Effect.gen(function* () {
        const known = yield* Ref.get(zoneId);
        if (Option.isSome(known)) return known.value;
        const zones = yield* call(
          'GET',
          `/zones?name=${encodeURIComponent(config.tunnelZone)}`,
          Schema.Array(Identified)
        );
        const found = zones[0]?.id;
        if (!found)
          return yield* new CloudflareFailed({ message: `No Cloudflare zone named ${config.tunnelZone}.` });
        yield* Ref.set(zoneId, Option.some(found));
        return found;
      });

      const updateIngress = Effect.fn('Cloudflare.updateIngress')(function* (
        tunnelId: string,
        hostname: string,
        localUrl: string
      ) {
        yield* call('PUT', `${account}/cfd_tunnel/${tunnelId}/configurations`, Schema.Unknown, {
          config: { ingress: [{ hostname, service: localUrl }, { service: 'http_status:404' }] },
        });
      });

      const createTunnel = Effect.fn('Cloudflare.createTunnel')(function* (
        name: string,
        hostname: string,
        localUrl: string
      ) {
        const tunnel = yield* call('POST', `${account}/cfd_tunnel`, Identified, {
          name,
          config_src: 'cloudflare',
        });
        return yield* Effect.gen(function* () {
          yield* updateIngress(tunnel.id, hostname, localUrl);
          const tunnelToken = yield* call(
            'GET',
            `${account}/cfd_tunnel/${tunnel.id}/token`,
            Schema.NonEmptyString
          );
          const record = yield* call('POST', `/zones/${yield* resolveZoneId}/dns_records`, Identified, {
            type: 'CNAME',
            name: hostname,
            content: `${tunnel.id}.cfargotunnel.com`,
            proxied: true,
          });
          return { tunnelId: tunnel.id, tunnelToken: Redacted.make(tunnelToken), dnsRecordId: record.id };
        }).pipe(
          Effect.onError(() =>
            call('DELETE', `${account}/cfd_tunnel/${tunnel.id}`, Schema.Unknown).pipe(
              Effect.catch((cleanup) =>
                Effect.logError('[Cloud] Could not remove a half-made tunnel').pipe(
                  Effect.annotateLogs({ tunnelId: tunnel.id, cleanup: cleanup.message })
                )
              )
            )
          )
        );
      });

      const removeTunnel = Effect.fn('Cloudflare.removeTunnel')(function* (
        tunnelId: string,
        dnsRecordId: string
      ) {
        yield* call('DELETE', `/zones/${yield* resolveZoneId}/dns_records/${dnsRecordId}`, Schema.Unknown);
        yield* call('DELETE', `${account}/cfd_tunnel/${tunnelId}?cascade=true`, Schema.Unknown);
      });

      return Cloudflare.of({ createTunnel, updateIngress, removeTunnel });
    })
  );
}
