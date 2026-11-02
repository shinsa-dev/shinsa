import { Context, type Effect, type Option } from 'effect';

export class LoginShell extends Context.Service<
  LoginShell,
  { run(program: string, args: ReadonlyArray<string>): Effect.Effect<Option.Option<string>> }
>()('shinsa/desktop/login-shell/LoginShell') {}
