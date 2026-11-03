import { Context, type Effect } from 'effect';
import type { Registration } from '../engine/schema.ts';

export class LoginItems extends Context.Service<
  LoginItems,
  {
    readonly status: Effect.Effect<Registration>;
    readonly register: Effect.Effect<Registration>;
    readonly unregister: Effect.Effect<void>;
  }
>()('shinsa/desktop/login-items/LoginItems') {}
