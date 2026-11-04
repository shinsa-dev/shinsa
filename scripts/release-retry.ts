import { Config, Console, Duration, Effect, Option, Redacted, Schedule, Schema } from 'effect';
import {
  type NotaryCredentials,
  NotarySubmission,
  ReleaseRefused,
  type RetryFailure,
} from './release/schema.ts';

export const NOTARY_SUBMIT_DELAYS = [Duration.seconds(30), Duration.minutes(1)];

export const STAPLE_DELAYS = [
  Duration.seconds(15),
  Duration.seconds(30),
  Duration.minutes(1),
  Duration.minutes(2),
];

const NOTARY_SECRETS = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] as const;

const decodeNotarySubmission = Schema.decodeUnknownEffect(Schema.fromJsonString(NotarySubmission));

export interface RetryOptions {
  readonly label: string;
  readonly delays: readonly Duration.Duration[];
  readonly onRetry: (failure: RetryFailure) => Effect.Effect<void>;
}

export function retryStep({ label, delays, onRetry }: RetryOptions) {
  const attempts = delays.length + 1;
  const [first, ...rest] = delays.map((delay) => Schedule.duration(delay));
  const waits: Schedule.Schedule<unknown> = first
    ? rest.reduce<Schedule.Schedule<unknown>>((schedule, next) => Schedule.concat(schedule, next), first)
    : Schedule.recurs(0);
  return <A, E extends { readonly message: string }, R>(step: Effect.Effect<A, E, R>) =>
    Effect.retry(
      step,
      waits.pipe(
        Schedule.setInputType<E>(),
        Schedule.tap(({ attempt, duration, input }) =>
          onRetry({ label, attempt, attempts, delay: Duration.toMillis(duration), error: input })
        )
      )
    );
}

export function describeRetryFailure(failure: RetryFailure) {
  const seconds = Math.round(failure.delay / 1000);
  return `${failure.label} failed on attempt ${failure.attempt} of ${failure.attempts} (${failure.error.message}). Trying again in ${seconds}s.`;
}

export function serializeRetryWarning(failure: RetryFailure, onGitHubActions: boolean) {
  const line = describeRetryFailure(failure);
  return onGitHubActions ? `::warning title=${failure.label}::${line}\n` : `${line}\n`;
}

export const isOnGitHubActions = Config.option(Config.String('GITHUB_ACTIONS')).pipe(
  Config.map((value) => Option.isSome(value) && value.value !== '')
);

export const warnRetry = Effect.fn('warnRetry')(function* (failure: RetryFailure) {
  const onGitHubActions = yield* Effect.orDie(isOnGitHubActions);
  yield* Console.log(serializeRetryWarning(failure, onGitHubActions).trimEnd());
});

export const resolveNotaryCredentials = Effect.fn('resolveNotaryCredentials')(function* () {
  const secrets = yield* Effect.orDie(
    Config.all(NOTARY_SECRETS.map((name) => Config.String(name).pipe(Config.withDefault(''))))
  );
  const missing = NOTARY_SECRETS.filter((_, index) => !secrets[index]);
  if (missing.length > 0)
    return yield* new ReleaseRefused({
      message: `Set ${missing.join(', ')} to notarize the app (docs/release.md).`,
    });
  const [appleId = '', password = '', teamId = ''] = secrets;
  const credentials: NotaryCredentials = { appleId, password: Redacted.make(password), teamId };
  return credentials;
});

export const parseNotarySubmission = Effect.fn('parseNotarySubmission')(function* (output: string) {
  return yield* decodeNotarySubmission(output).pipe(
    Effect.mapError(
      () =>
        new ReleaseRefused({
          message: `notarytool did not return a submission id and status: ${output.trim()}`,
        })
    )
  );
});

export function describeNotaryRejection(submission: NotarySubmission, log: string) {
  return `Apple did not accept submission ${submission.id}: its status is ${submission.status}.\n${log.trim()}`;
}
