import { describe, expect, test } from 'bun:test';
import {
  createSettings,
  createState,
  MAX_COMPACTION_LEAD_MINUTES,
  resolveAccountSwitchAt,
  resolveAgentFastMode,
  resolveAttentionLimit,
  resolveCompaction,
  resolveDelegationLimit,
  resolveFastMode,
  resolveIdleCompaction,
  resolveWatchdogDefaults,
  SETTINGS_KEYS,
  type Settings,
} from '../../src/index.ts';

describe('settings', () => {
  test('a new state gets its own copy of the defaults', () => {
    const state = createState();
    state.settings.agentModels = { agent: 'haiku' };
    state.settings.maxFixRounds = 3;
    expect(createState().settings.agentModels).toEqual({});
    expect(createState().settings.maxFixRounds).toBeNull();
    expect(createState().settings).toEqual(createSettings());
  });

  test('the attention limit is at least one', () => {
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: 0 })).toBe(1);
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: undefined })).toBe(1);
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: 3 })).toBe(3);
  });
});

describe('the settings a command may change', () => {
  test('are every setting there is, and nothing else', () => {
    const every: Required<Settings> = {
      defaultProvider: 'claude',
      defaultModel: null,
      maxFixRounds: null,
      delegationLimit: null,
      mergeMethod: 'squash',
      attentionLimit: 1,
      approvePlans: false,
      agentModels: {},
      agentProviders: {},
      agentFastModes: {},
      taskBudgetUsd: null,
      taskUsageLimit: null,
      autoResume: true,
      snoozeLimited: false,
      accountSwitchAt: 90,
      idleCompaction: false,
      compactionLeadMinutes: 2,
      compaction: 'eunoe_compact',
      fastMode: false,
      watchdogHours: 72,
      watchdogFirstCheckMinutes: 30,
      watchdogMaxGapHours: 6,
      taskCapacity: null,
      placementRules: [],
    };
    expect(Object.keys(every).sort()).toEqual([...SETTINGS_KEYS].sort());
  });
});

describe('resolveWatchdogDefaults', () => {
  test('watches for 72 hours, first after 30 minutes, gaps up to 6 hours, unless the settings say otherwise', () => {
    expect(resolveWatchdogDefaults(createSettings())).toEqual({
      hours: 72,
      firstCheckMinutes: 30,
      maxGapHours: 6,
    });
    expect(
      resolveWatchdogDefaults({
        ...createSettings(),
        watchdogHours: undefined,
        watchdogFirstCheckMinutes: undefined,
        watchdogMaxGapHours: 2,
      })
    ).toEqual({ hours: 72, firstCheckMinutes: 30, maxGapHours: 2 });
  });
});

describe('resolveDelegationLimit', () => {
  test('sets no limit on delegations at once unless one is chosen', () => {
    expect(createSettings().delegationLimit).toBeNull();
    expect(resolveDelegationLimit(createSettings())).toBeNull();
    expect(resolveDelegationLimit({ ...createSettings(), delegationLimit: undefined })).toBeNull();
    expect(resolveDelegationLimit({ ...createSettings(), delegationLimit: 4 })).toBe(4);
  });
});

describe('resolveAccountSwitchAt', () => {
  test('switches accounts at 90% by default, at any whole percentage you choose, never outside 1 to 100', () => {
    expect(resolveAccountSwitchAt(createSettings())).toBe(90);
    expect(resolveAccountSwitchAt({ ...createSettings(), accountSwitchAt: undefined })).toBe(90);
    expect(resolveAccountSwitchAt({ ...createSettings(), accountSwitchAt: 73 })).toBe(73);
    expect(resolveAccountSwitchAt({ ...createSettings(), accountSwitchAt: 0 })).toBe(1);
    expect(resolveAccountSwitchAt({ ...createSettings(), accountSwitchAt: 150 })).toBe(100);
  });

  test('a new state resumes after a usage limit and hides limited tasks until the reset', () => {
    expect(createState().settings).toMatchObject({
      autoResume: true,
      snoozeLimited: true,
      accountSwitchAt: 90,
    });
  });
});

describe('resolveIdleCompaction', () => {
  const claude = ['claude'];

  test('idle sessions are never compacted unless you turn it on', () => {
    expect(resolveIdleCompaction(createSettings(), claude)).toEqual({
      available: false,
      enabled: false,
      leadMinutes: 2,
    });
    expect(resolveIdleCompaction({ ...createSettings(), compaction: 'claude' }, claude)).toEqual({
      available: true,
      enabled: false,
      leadMinutes: 2,
    });
  });

  test('compacts before the cache expires only with Claude Code compacting, within 1 to 30 minutes', () => {
    const settings = { ...createSettings(), compaction: 'claude' as const, idleCompaction: true };
    expect(resolveIdleCompaction(settings, claude)).toEqual({
      available: true,
      enabled: true,
      leadMinutes: 2,
    });
    expect(resolveIdleCompaction({ ...settings, compactionLeadMinutes: 0 }, claude)).toMatchObject({
      leadMinutes: 1,
    });
    expect(resolveIdleCompaction({ ...settings, compactionLeadMinutes: 90 }, claude)).toMatchObject({
      leadMinutes: MAX_COMPACTION_LEAD_MINUTES,
    });
    expect(resolveIdleCompaction({ ...settings, compactionLeadMinutes: undefined }, claude)).toMatchObject({
      leadMinutes: 2,
    });
  });

  test('eunoe or no compaction leaves nothing to compact for Claude while a session is idle', () => {
    for (const compaction of ['eunoe_compact', 'eunoe_default', 'off'] as const) {
      expect(
        resolveIdleCompaction({ ...createSettings(), compaction, idleCompaction: true }, claude)
      ).toMatchObject({
        available: false,
        enabled: false,
      });
    }
  });

  test('Codex compacts natively under every setting but off, so idle compaction is there for it', () => {
    for (const compaction of ['eunoe_compact', 'eunoe_default', 'claude'] as const) {
      const settings = { ...createSettings(), compaction, idleCompaction: true };
      expect(resolveIdleCompaction(settings, ['codex'])).toMatchObject({ available: true, enabled: true });
      expect(resolveIdleCompaction(settings, ['claude', 'codex'])).toMatchObject({ available: true });
    }
    const off = { ...createSettings(), compaction: 'off' as const, idleCompaction: true };
    expect(resolveIdleCompaction(off, ['codex'])).toMatchObject({ available: false, enabled: false });
    expect(resolveIdleCompaction(off, [])).toMatchObject({ available: false });
  });
});

describe('resolveCompaction and resolveFastMode', () => {
  test('eunoe compacts and agents run at standard speed by default', () => {
    expect(resolveCompaction(createSettings())).toBe('eunoe_compact');
    expect(resolveCompaction({ ...createSettings(), compaction: undefined })).toBe('eunoe_compact');
    expect(resolveFastMode(createSettings())).toBe(false);
    expect(resolveFastMode({ ...createSettings(), fastMode: undefined })).toBe(false);
    expect(resolveFastMode({ ...createSettings(), fastMode: true })).toBe(true);
  });

  test('a role runs in fast mode when it is switched on for that role, otherwise as the global switch says', () => {
    expect(resolveAgentFastMode(createSettings(), 'agent')).toBe(false);
    const fast = { ...createSettings(), fastMode: true };
    expect(resolveAgentFastMode(fast, 'agent')).toBe(true);
    const mixed = { ...fast, agentFastModes: { agent: false, classifier: true } };
    expect(resolveAgentFastMode(mixed, 'agent')).toBe(false);
    expect(resolveAgentFastMode(mixed, 'answerer')).toBe(true);
    const standard = { ...createSettings(), agentFastModes: { reviewer: true } };
    expect(resolveAgentFastMode(standard, 'reviewer')).toBe(true);
    expect(resolveAgentFastMode(standard, 'writer')).toBe(false);
    expect(resolveAgentFastMode({ ...standard, agentFastModes: undefined }, 'reviewer')).toBe(false);
  });
});
