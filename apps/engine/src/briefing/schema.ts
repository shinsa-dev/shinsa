import { Duration } from 'effect';

export interface DebouncedWrite {
  readonly schedule: () => void;
  readonly cancel: () => void;
}

const BRIEFING_DEBOUNCE = Duration.seconds(4);

export const BRIEFING_DEBOUNCE_MS = Duration.toMillis(BRIEFING_DEBOUNCE);
