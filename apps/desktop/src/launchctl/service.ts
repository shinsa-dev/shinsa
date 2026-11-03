import { Context, type Effect } from 'effect';
import type { LaunchctlResult } from './schema.ts';

export class Launchctl extends Context.Service<
  Launchctl,
  { run(args: ReadonlyArray<string>): Effect.Effect<LaunchctlResult> }
>()('shinsa/desktop/launchctl/Launchctl') {}
