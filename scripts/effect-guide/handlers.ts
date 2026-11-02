import { Config, Effect, Layer, Redacted } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { CurrentAccount, GuideApi, Session, Unauthorized } from './api.ts';
import { Machines } from './machines.ts';

const isSameSecret = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

const isSameToken = Redacted.makeEquivalence(isSameSecret);

const SessionLayer = Layer.effect(
  Session,
  Effect.gen(function* () {
    const accepted = yield* Config.Redacted('GUIDE_SESSION_TOKEN');
    return Session.of({
      bearer: Effect.fn('Session.bearer')(function* (httpEffect, { credential }) {
        if (!isSameToken(credential, accepted))
          return yield* new Unauthorized({ message: 'Sign in again to continue.' });
        return yield* Effect.provideService(httpEffect, CurrentAccount, { login: 'kai' });
      }),
    });
  })
);

const MachinesHandlers = HttpApiBuilder.group(
  GuideApi,
  'machines',
  Effect.fn(function* (handlers) {
    const machines = yield* Machines;
    return handlers.handleAll({
      list: () => machines.list,
      find: ({ params }) => machines.find(params.id),
      pair: ({ payload }) => machines.pair(payload),
    });
  })
);

const GuideRoutes = HttpApiBuilder.layer(GuideApi).pipe(
  Layer.provide(MachinesHandlers),
  Layer.provide(SessionLayer)
);

export const makeGuideHandler = <E>(services: Layer.Layer<Machines, E>) =>
  HttpRouter.toWebHandler(
    GuideRoutes.pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true }
  );
