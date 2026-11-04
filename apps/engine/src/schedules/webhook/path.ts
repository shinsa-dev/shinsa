import { WEBHOOK_ROUTE_PREFIX } from '../schema.ts';

export function isWebhookPath(pathname: string) {
  return pathname.startsWith(`${WEBHOOK_ROUTE_PREFIX}/`);
}
