import { WEBHOOK_ROUTE_PREFIX } from '../../../schedules/schema.ts';

export const WEBHOOK_ROUTE = `${WEBHOOK_ROUTE_PREFIX}/*` as const;
