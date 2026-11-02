import { WEBHOOK_ROUTE_PREFIX } from '../../../schedules/webhook.ts';

export const WEBHOOK_ROUTE = `${WEBHOOK_ROUTE_PREFIX}/*` as const;
