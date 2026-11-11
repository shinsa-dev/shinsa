import { parseRetryAfter } from './usage/answer.ts';

export {
  listDistinctWindows,
  parseExtraUsage,
  parseResetGrants,
  parseResetTime,
  parseUsageWindows,
  resolveClaudeFastMode,
} from './usage/answer.ts';
export { type KeyedWindow, PROVIDER_WINDOWS, type UsageRead } from './schema.ts';

export type UsageRequester = (url: string, init: RequestInit) => Promise<Response>;

export function readRetryAfter(response: Response) {
  return parseRetryAfter(response.headers.get('retry-after'));
}
