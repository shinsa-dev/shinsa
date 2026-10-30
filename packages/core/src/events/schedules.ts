import type { Schedule, ScheduleRun, WatchSuggestion } from '../domain/index.ts';

export type ScheduleEventBody =
  | { type: 'schedule.written'; schedule: Schedule }
  | { type: 'schedule.removed'; scheduleId: string }
  | { type: 'schedule.read'; scheduleId: string; readFrom: number }
  | { type: 'watch_suggestion.recorded'; suggestion: WatchSuggestion }
  | { type: 'watch_suggestion.accepted'; suggestionId: string; scheduleId: string }
  | { type: 'watch_suggestion.dismissed'; suggestionId: string }
  | { type: 'watch_suggestion.removed'; suggestionId: string }
  | {
      type: 'schedule.fired';
      scheduleId: string;
      run: ScheduleRun;
      nextRunAt: number | null;
      runCount: number;
      lastTaskId: string | null;
      lastRunId: string | null;
      stopped: Schedule['stopped'];
      replayKey: string | null;
    };
