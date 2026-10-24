import { describe, expect, it } from 'bun:test';
import { createSettings, type Settings } from '@shinsa/core';
import {
  describePercentChoice,
  describeSwitchAtChange,
  listAccountSwitchItems,
  listSwitchItems,
  needsSnoozeSetting,
  parsePercent,
  parseSwitchValue,
  resolveAccountSwitchValue,
  resolveResumeValue,
  resolveSnoozeValue,
  resolveSwitchValue,
} from '@/lib/accounts/limits.ts';
import { createAccount } from '../../support/accounts.ts';

const SETTINGS = createSettings();

describe('switch thresholds', () => {
  it('offers the usual percentages, a stored custom one, and a custom entry', () => {
    expect(listSwitchItems(SETTINGS).map((item) => item.label)).toEqual([
      '80%',
      '90%',
      '95%',
      '98%',
      'Other…',
    ]);
    expect(resolveSwitchValue(SETTINGS)).toBe('90');
    const custom: Settings = { ...SETTINGS, accountSwitchAt: 85 };
    expect(listSwitchItems(custom).map((item) => item.value)).toEqual([
      '80',
      '85',
      '90',
      '95',
      '98',
      'other',
    ]);
  });

  it('lets an account follow the setting or keep its own threshold', () => {
    const following = createAccount({ id: 'a' });
    expect(listAccountSwitchItems(following, SETTINGS).map((item) => item.label)).toEqual([
      'Use the setting (90%)',
      '80%',
      '90%',
      '95%',
      '98%',
      'Other…',
    ]);
    expect(resolveAccountSwitchValue(following)).toBe('setting');
    const own = createAccount({ id: 'a', switchAt: 70 });
    expect(listAccountSwitchItems(own, SETTINGS).map((item) => item.value)).toContain('70');
    expect(resolveAccountSwitchValue(own)).toBe('70');
    expect(parseSwitchValue('setting')).toBeNull();
    expect(parseSwitchValue('95')).toBe(95);
  });

  it('says what a threshold change and a custom one mean', () => {
    const account = createAccount({ id: 'a' });
    expect(describeSwitchAtChange(account, 95)).toBe('Switches away from a@example.com at 95%.');
    expect(describeSwitchAtChange(account, null)).toBe('a@example.com follows the setting.');
    expect(describePercentChoice(account)).toBe(
      'New work moves off a@example.com once its usage reaches this percentage.'
    );
    expect(describePercentChoice(null)).toBe(
      'New work moves to another account once usage reaches this percentage.'
    );
  });

  it('reads a whole percentage from 1 to 100 and nothing else', () => {
    expect(parsePercent(' 85 ')).toBe(85);
    expect(parsePercent('85 %')).toBe(85);
    expect(parsePercent('100')).toBe(100);
    expect(parsePercent('0')).toBeNull();
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('8.5')).toBeNull();
    expect(parsePercent('lots')).toBeNull();
  });
});

describe('limit settings', () => {
  it('resumes automatically, and without that asks you at the reset unless switched to right away', () => {
    expect(resolveResumeValue(SETTINGS)).toBe('auto');
    expect(resolveResumeValue({ ...SETTINGS, autoResume: undefined })).toBe('auto');
    expect(resolveResumeValue({ ...SETTINGS, autoResume: false })).toBe('wait');
    expect(resolveSnoozeValue({ ...SETTINGS, snoozeLimited: undefined })).toBe('on');
    expect(resolveSnoozeValue({ ...SETTINGS, snoozeLimited: false })).toBe('off');
  });

  it('asks when to ask you only while a limit waits for you', () => {
    expect(needsSnoozeSetting(SETTINGS)).toBe(false);
    expect(needsSnoozeSetting({ ...SETTINGS, autoResume: undefined })).toBe(false);
    expect(needsSnoozeSetting({ ...SETTINGS, autoResume: false })).toBe(true);
  });
});
