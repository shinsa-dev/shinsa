export type WatchdogSystemCommand = {
  type: 'watchdog.fire';
  taskId: string;
  watchdogId: string;
  dueAt: number;
};
