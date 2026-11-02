import type { Effect } from 'effect';

export const HEALTH_TIMEOUT = '10 seconds';

export interface HealthCheck {
  check(url: string): Effect.Effect<boolean>;
}
