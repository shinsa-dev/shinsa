import { Duration, Schema } from 'effect';

export const LAUNCHCTL_PROGRAM = '/bin/launchctl';

export const LAUNCHCTL_TIMEOUT = Duration.seconds(15);

export const LaunchctlResult = Schema.Struct({ ok: Schema.Boolean, output: Schema.String });

export type LaunchctlResult = typeof LaunchctlResult.Type;
