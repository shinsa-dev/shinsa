import type { Schedule, ScheduleRun } from '../domain/index.ts';

export type ScheduleEventBody =
  | { type: 'schedule.written'; schedule: Schedule }
  | { type: 'schedule.removed'; scheduleId: string }
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
