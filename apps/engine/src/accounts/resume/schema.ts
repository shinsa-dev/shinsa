import { Context, Duration } from 'effect';
import { USAGE_RESUME_GRACE, USAGE_RESUME_RETRY } from '../schema.ts';

export interface UsageResumeTimings {
  readonly grace: Duration.Duration;
  readonly retry: Duration.Duration;
}

export const UsageResumeTimingSettings = Context.Reference<UsageResumeTimings>(
  'shinsa/engine/accounts/resume/UsageResumeTimingSettings',
  { defaultValue: (): UsageResumeTimings => ({ grace: USAGE_RESUME_GRACE, retry: USAGE_RESUME_RETRY }) }
);

export const RESUME_MIN_DELAY = Duration.zero;
