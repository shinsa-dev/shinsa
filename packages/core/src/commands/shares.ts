export type ShareUserCommand =
  | { type: 'task.share'; taskId: string }
  | { type: 'task.unshare'; taskId: string };

export type ShareSystemCommand = { type: 'share.record'; taskId: string; url: string };
