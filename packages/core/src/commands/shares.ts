export type ShareSystemCommand =
  | { type: 'share.record'; taskId: string; url: string | null }
  | { type: 'share.fail'; taskId: string; detail: string }
  | { type: 'share.expire'; taskId: string }
  | { type: 'share.describe'; taskId: string; description: string }
  | { type: 'preview.record'; taskId: string; serviceId: string; url: string | null }
  | { type: 'preview.fail'; taskId: string; serviceId: string; detail: string }
  | { type: 'preview.expire'; taskId: string; serviceId: string };
