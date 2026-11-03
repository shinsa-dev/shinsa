import { Effect, Layer } from 'effect';
import { app } from 'electron';
import { parseRegistration } from '../engine/launchd.ts';
import { ENGINE_PLIST, type Registration } from '../engine/schema.ts';
import { LoginItems } from '../login-items/service.ts';

const unsupported = Effect.succeed<Registration>('unsupported');

const status = Effect.try(() =>
  parseRegistration(app.getLoginItemSettings({ type: 'agentService', serviceName: ENGINE_PLIST }).status)
).pipe(Effect.catch(() => unsupported));

const applyOpenAtLogin = (openAtLogin: boolean) =>
  Effect.try(() =>
    app.setLoginItemSettings({ openAtLogin, type: 'agentService', serviceName: ENGINE_PLIST })
  );

export const LoginItemsLive = Layer.succeed(
  LoginItems,
  LoginItems.of({
    status,
    register: applyOpenAtLogin(true).pipe(
      Effect.flatMap(() => status),
      Effect.catch(() => unsupported)
    ),
    unregister: Effect.ignore(applyOpenAtLogin(false)),
  })
);
