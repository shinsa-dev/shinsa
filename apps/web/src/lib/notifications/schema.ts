import { Schema } from 'effect';

export const NOTIFICATION_OPEN = 'shinsa-notification-open';

export const NOTIFICATION_FAILED = 'The notification could not be shown or opened.';

const AppPath = Schema.String.check(
  Schema.makeFilter((path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'))
);

export const NotificationData = Schema.Struct({ path: AppPath });

export const NotificationOpen = Schema.Struct({ type: Schema.Literal(NOTIFICATION_OPEN), path: AppPath });

export type NotificationOpen = typeof NotificationOpen.Type;

export class NotificationFailed extends Schema.TaggedError<
  NotificationFailed,
  { readonly brand: unique symbol }
>()('NotificationFailed', { message: Schema.String }) {}

interface WindowClientLike {
  focused: boolean;
  focus: () => Promise<unknown>;
  postMessage: (message: NotificationOpen) => void;
}

export interface NotificationClients {
  matchAll: (options: { type: 'window' }) => Promise<readonly WindowClientLike[]>;
  openWindow: (url: string) => Promise<unknown>;
}

export type NotificationWorker = Pick<ServiceWorkerContainer, 'controller' | 'ready'>;
