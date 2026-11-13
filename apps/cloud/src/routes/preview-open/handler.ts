import {
  createPreviewAccessToken,
  InstanceId,
  PREVIEW_ACCESS_PARAM,
  PREVIEW_KEY_PARAM,
  PREVIEW_OPEN_TTL_MS,
  parsePreviewHost,
  REMOTE_PATHS,
} from '@shinsa/core';
import { UrlInvalid } from '@shinsa/core/remote/errors';
import { Clock, Effect, Layer, Option, Redacted, Schema } from 'effect';
import { HttpRouter } from 'effect/http';
import { findReachableMachine } from '../../auth/access.ts';
import { selectRequestUser } from '../../auth/tokens.ts';
import { CloudConfig } from '../../config/service.ts';
import { CurrentUrl } from '../../http/request.ts';
import { respondRedirect, respondSignInRedirect } from '../../http/responses.ts';

export const PreviewOpenRoutes = Layer.unwrap(
  Effect.sync(() => {
    const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);
    const readPreviewTarget = Effect.fn('previews.readTarget')(function* (url: URL, previewOrigin: string) {
      const value = url.searchParams.get('url');
      const target = value && URL.canParse(value) ? new URL(value) : null;
      const address = target && Option.getOrNull(parsePreviewHost(target.host, previewOrigin));
      const instanceId = address ? decodeInstanceId(address.instanceId) : Option.none();
      if (
        !target ||
        !address ||
        Option.isNone(instanceId) ||
        target.protocol !== new URL(previewOrigin).protocol
      )
        return yield* new UrlInvalid({
          message: 'This is not the address of a service on a machine of yours.',
        });
      return { target, address, instanceId: instanceId.value };
    });

    const respondPreviewOpen = Effect.gen(function* () {
      const url = yield* CurrentUrl;
      const config = yield* CloudConfig;
      const { target, address, instanceId } = yield* readPreviewTarget(url, config.previewOrigin);
      const user = yield* selectRequestUser;
      if (Option.isNone(user)) return respondSignInRedirect(config.origin, url);
      const machine = yield* findReachableMachine(user.value.id, instanceId);
      const now = yield* Clock.currentTimeMillis;
      const token = yield* createPreviewAccessToken(Redacted.value(machine.connectKey), {
        ...address,
        userId: user.value.id,
        expiresAt: now + PREVIEW_OPEN_TTL_MS,
      }).pipe(Effect.orDie);
      const location = new URL(`${target.origin}${target.pathname}${target.search}${target.hash}`);
      location.searchParams.delete(PREVIEW_KEY_PARAM);
      location.searchParams.set(PREVIEW_ACCESS_PARAM, token);
      return respondRedirect(location.href, { status: 303, headers: { 'referrer-policy': 'no-referrer' } });
    });

    return HttpRouter.add('GET', REMOTE_PATHS.previewOpen, respondPreviewOpen);
  })
);
