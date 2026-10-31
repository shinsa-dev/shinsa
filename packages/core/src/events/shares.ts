export type ShareEventBody =
  | { type: 'task.shared'; taskId: string }
  | { type: 'task.unshared'; taskId: string }
  | { type: 'share.recorded'; taskId: string; url: string };
