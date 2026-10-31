import { readResponseFields } from './http.ts';
import type { CloudWorld } from './world.ts';

const SLACK_API_ORIGIN = 'https://slack.com';

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'groups:history',
  'chat:write',
  'users:read',
] as const;

export const SLACK_USER_SCOPES = ['openid', 'profile'] as const;

export class SlackApiError extends Error {
  readonly code: string;

  constructor(method: string, code: string) {
    super(`Slack answered ${method} with ${code}.`);
    this.name = 'SlackApiError';
    this.code = code;
  }
}

type Fields = Record<string, unknown>;

interface SlackCall {
  token?: string | null;
  form?: Record<string, string>;
  json?: Fields;
}

export async function requestSlack(world: CloudWorld, method: string, call: SlackCall): Promise<Fields> {
  const headers: Record<string, string> = {};
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  let body: string | undefined;
  if (call.json) {
    headers['content-type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(call.json);
  } else if (call.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(call.form).toString();
  }
  let response: Response;
  try {
    response = await world.fetch(`${SLACK_API_ORIGIN}/api/${method}`, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new SlackApiError(method, 'unreachable');
  }
  const fields = await readResponseFields(response);
  if (fields.ok !== true)
    throw new SlackApiError(method, typeof fields.error === 'string' ? fields.error : 'failed');
  return fields;
}

export function readSlackText(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readSlackFields(fields: Fields, key: string): Fields {
  const value = fields[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {};
}

export async function requestSlackUserName(world: CloudWorld, token: string, userId: string) {
  try {
    const user = readSlackFields(
      await requestSlack(world, 'users.info', { token, form: { user: userId } }),
      'user'
    );
    const profile = readSlackFields(user, 'profile');
    return (
      readSlackText(profile, 'display_name') ??
      readSlackText(profile, 'real_name') ??
      readSlackText(user, 'name')
    );
  } catch {
    return null;
  }
}
