import { type AccountSummary, resolveAccountSwitchAt, type Settings } from '@shinsa/core';
import { resolveAccountLabel } from '@/lib/accounts/account.ts';
import type { SettingItem } from '@/lib/settings.ts';

const SWITCH_PERCENTS = [80, 90, 95, 98];

const USE_SETTING = 'setting';

export const OTHER_PERCENT = 'other';

export const PERCENT_HINT = 'Enter a whole percentage from 1 to 100.';

function createPercentItem(percent: number): SettingItem<string> {
  return { value: String(percent), label: `${percent}%`, icon: 'IconGauge' };
}

function listPercents(current: number | null) {
  if (current === null || SWITCH_PERCENTS.includes(current)) return SWITCH_PERCENTS;
  return [...SWITCH_PERCENTS, current].sort((a, b) => a - b);
}

const OTHER_ITEM: SettingItem<string> = { value: OTHER_PERCENT, label: 'Other…', icon: 'IconPencil' };

export function listSwitchItems(settings: Settings): SettingItem<string>[] {
  return [...listPercents(resolveAccountSwitchAt(settings)).map(createPercentItem), OTHER_ITEM];
}

export function resolveSwitchValue(settings: Settings) {
  return String(resolveAccountSwitchAt(settings));
}

export function listAccountSwitchItems(account: AccountSummary, settings: Settings): SettingItem<string>[] {
  return [
    {
      value: USE_SETTING,
      label: `Use the setting (${resolveAccountSwitchAt(settings)}%)`,
      icon: 'IconGauge',
    },
    ...listPercents(account.switchAt).map(createPercentItem),
    OTHER_ITEM,
  ];
}

export function resolveAccountSwitchValue(account: AccountSummary) {
  return account.switchAt === null ? USE_SETTING : String(account.switchAt);
}

export function parseSwitchValue(value: string) {
  return value === USE_SETTING ? null : Number(value);
}

export function describeSwitchAtChange(account: AccountSummary, switchAt: number | null) {
  const label = resolveAccountLabel(account);
  return switchAt === null ? `${label} follows the setting.` : `Switches away from ${label} at ${switchAt}%.`;
}

export const PERCENT_TITLE = 'Switch accounts at another percentage';

export function describePercentChoice(account: AccountSummary | null) {
  if (!account) return 'New work moves to another account once usage reaches this percentage.';
  return `New work moves off ${resolveAccountLabel(account)} once its usage reaches this percentage.`;
}

export function parsePercent(text: string) {
  const trimmed = text.trim().replace(/%$/, '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent >= 1 && percent <= 100 ? percent : null;
}

export const RESUME_ITEMS: SettingItem<string>[] = [
  { value: 'auto', label: 'Resume automatically', icon: 'IconPlay' },
  { value: 'wait', label: 'Wait for me', icon: 'IconPause' },
];

export function resolveResumeValue(settings: Settings) {
  return isAutoResume(settings) ? 'auto' : 'wait';
}

function isAutoResume(settings: Settings) {
  return settings.autoResume ?? true;
}

export const SNOOZE_TITLE = 'Ask me what to do';

export const SNOOZE_ITEMS: SettingItem<string>[] = [
  { value: 'on', label: 'When the limit resets', icon: 'IconHourglass' },
  { value: 'off', label: 'Right away', icon: 'IconBell' },
];

export function resolveSnoozeValue(settings: Settings) {
  return (settings.snoozeLimited ?? true) ? 'on' : 'off';
}

export function needsSnoozeSetting(settings: Settings) {
  return !isAutoResume(settings);
}
