import { Context, Duration } from 'effect';

export const LeadWakeDebounce = Context.Reference<Duration.Duration>(
  'shinsa/engine/initiatives/LeadWakeDebounce',
  {
    defaultValue: () => Duration.seconds(30),
  }
);
