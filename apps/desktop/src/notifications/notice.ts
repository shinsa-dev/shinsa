import { Option, Schema } from 'effect';
import { BadgeCount, type DesktopNotice, NOTIFICATION_SETTINGS_URL, NoticePayload } from './schema.ts';

const isBadgeCount = Schema.is(BadgeCount);

const decodeNotice = Schema.decodeUnknownOption(NoticePayload);

export function parseNotice(payload: unknown): DesktopNotice | null {
  return Option.getOrNull(decodeNotice(payload));
}

export function resolveBadgeText(count: unknown) {
  return isBadgeCount(count) ? String(count) : '';
}

export function resolveNotificationSettingsUrl(appId: string) {
  return `${NOTIFICATION_SETTINGS_URL}?id=${encodeURIComponent(appId)}`;
}
