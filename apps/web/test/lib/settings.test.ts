import { describe, expect, it } from 'bun:test';
import {
  type AccountSummary,
  type AgentProviderInfo,
  createSettings,
  type FastModeAvailability,
  type Settings,
  type UsageRate,
} from '@shinsa/core';
import {
  AGENT_GROUPS,
  AGENT_ROLES,
  type AgentGroup,
  COMPACTION_MODE_ITEMS,
  describeFollowedRole,
  describeGroupSelects,
  describeRoleSelects,
  describeUsageLimitNote,
  FAST_MODE_ITEMS,
  FAST_MODE_UNAVAILABLE,
  FIX_ROUND_ITEMS,
  listAgentModelItems,
  listAttentionItems,
  listBudgetItems,
  listCompactionItems,
  listDelegationLimitItems,
  listGroupModelItems,
  listGroupSpeedItems,
  listSpeedItems,
  listUsageLimitItems,
  listWatchdogSettingItems,
  MERGE_ITEMS,
  MIXED_VALUE,
  needsCostLimit,
  PLAN_ITEMS,
  parseBudget,
  parseCompaction,
  parseDelegationCount,
  parseDelegationLimit,
  parseFixRounds,
  parseUsageLimit,
  resolveAgentModelPatch,
  resolveAgentModelValue,
  resolveAgentSpeedPatch,
  resolveAttentionValue,
  resolveBudgetValue,
  resolveCompactionValue,
  resolveDelegationLimitValue,
  resolveFixRoundValue,
  resolveGroupModel,
  resolveGroupModelPatch,
  resolveGroupSpeed,
  resolveGroupSpeedPatch,
  resolveHashSectionId,
  resolvePlanValue,
  resolveRootAdded,
  resolveRootRemoved,
  resolveRootToggled,
  resolveSectionId,
  resolveSpeedAvailability,
  resolveSpeedValue,
  resolveUsageLimitValue,
  resolveWatchdogSettingValue,
  updateSettings,
  WATCHDOG_SETTING_FIELDS,
} from '@/lib/settings.ts';
import { createAccount, createProviderLogin, createSnapshot } from '../support/accounts.ts';
import { spyOnCommands } from '../support/commands.ts';

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...createSettings(), ...overrides };
}

describe('setting choices', () => {
  it('offers no limit on delegations at once by default, the usual limits and a custom entry', () => {
    expect(listDelegationLimitItems(settings()).map((item) => [item.value, item.label])).toEqual([
      ['off', 'No limit'],
      ['2', '2 at once'],
      ['4', '4 at once'],
      ['8', '8 at once'],
      ['16', '16 at once'],
      ['custom', 'Custom…'],
    ]);
    expect(resolveDelegationLimitValue(settings())).toBe('off');
    expect(resolveDelegationLimitValue(settings({ delegationLimit: 4 }))).toBe('4');
    const custom = listDelegationLimitItems(settings({ delegationLimit: 12 })).map((item) => item.value);
    expect(custom).toEqual(['off', '2', '4', '8', '12', '16', 'custom']);
    expect(parseDelegationLimit('off')).toBeNull();
    expect(parseDelegationLimit('8')).toBe(8);
  });

  it('reads a typed delegation limit only as a whole number of one or more', () => {
    expect(parseDelegationCount(' 12 ')).toBe(12);
    expect(parseDelegationCount('1')).toBe(1);
    for (const text of ['0', '2.5', '-3', 'six', '', '99999999999999999999']) {
      expect(parseDelegationCount(text)).toBeNull();
    }
  });

  it('adds a stored attention limit that is not one of the usual choices, so the select shows it', () => {
    const items = listAttentionItems(settings({ attentionLimit: 4 }));
    expect(items.map((item) => item.value)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('labels attention limits and fix rounds agreeing with their number', () => {
    expect(listAttentionItems(settings()).map((item) => item.label)).toEqual([
      'One at a time',
      '2 at a time',
      '3 at a time',
      '5 at a time',
    ]);
    expect(FIX_ROUND_ITEMS.map((item) => item.label)).toEqual([
      'Until clean',
      '1 round',
      '2 rounds',
      '3 rounds',
      '5 rounds',
      '10 rounds',
    ]);
  });

  it('offers plan, merge and role choices', () => {
    expect(PLAN_ITEMS.map((item) => item.value)).toEqual(['when_asked', 'large', 'always']);
    expect(MERGE_ITEMS.map((item) => item.value)).toEqual(['squash', 'merge', 'rebase']);
    expect(AGENT_GROUPS.map((group) => [group.title, group.roles.map((entry) => entry.title)])).toEqual([
      ['Task agents', ['Agent', 'Reviewer', 'Answerer']],
      ['Quick jobs', ['Classifier', 'Writer']],
    ]);
    expect(AGENT_ROLES.map((entry) => entry.role)).toEqual([
      'agent',
      'reviewer',
      'answerer',
      'classifier',
      'writer',
    ]);
  });

  it('names what each group holds in one sentence, and every role in a sentence of its own', () => {
    expect(AGENT_GROUPS.map((group) => group.description)).toEqual([
      'They plan, build, review and fix the work, answer questions, investigate problems, do research and run operations.',
      'They sort new tasks and your messages, and write the guide on Home.',
    ]);
    const described = AGENT_GROUPS.flatMap((group) => [...group.roles, ...group.following]);
    expect(described.every((entry) => /^[A-Z].+\.$/.test(entry.description))).toBe(true);
    expect(AGENT_ROLES[0]?.description).toBe(
      'Plans, builds and fixes each round in one conversation, and runs its operation.'
    );
  });

  it('lists the investigator and researcher under task agents, following the role whose settings they use', () => {
    const [task, quick] = AGENT_GROUPS as [AgentGroup, AgentGroup];
    expect(task.following.map((entry) => [entry.title, describeFollowedRole(entry)])).toEqual([
      ['Investigator', 'Follows the answerer'],
      ['Researcher', 'Follows the answerer'],
    ]);
    expect(quick.following).toEqual([]);
  });
});

describe('setting values', () => {
  it('reads the attention limit as a choice', () => {
    expect(resolveAttentionValue(settings({ attentionLimit: 3 }))).toBe('3');
    expect(resolveAttentionValue(settings({ attentionLimit: 0 }))).toBe('1');
  });

  it('reads which plans need approval, when you ask by default', () => {
    expect(resolvePlanValue(settings({ approvePlans: 'large' }))).toBe('large');
    expect(resolvePlanValue(settings({ approvePlans: 'always' }))).toBe('always');
    expect(resolvePlanValue(settings({ approvePlans: undefined }))).toBe('when_asked');
  });

  it('round-trips the fix round limit, with no limit as until clean', () => {
    expect(resolveFixRoundValue(settings({ maxFixRounds: null }))).toBe('endless');
    expect(resolveFixRoundValue(settings({ maxFixRounds: 5 }))).toBe('5');
    expect(parseFixRounds('endless')).toBeNull();
    expect(parseFixRounds('5')).toBe(5);
  });

  it('reads the provider and model chosen for a role as one value, falling back to the default', () => {
    expect(resolveAgentModelValue(settings({ agentModels: { agent: 'sonnet' } }), 'agent')).toBe(
      'claude:sonnet'
    );
    expect(resolveAgentModelValue(settings({ defaultModel: 'opus' }), 'reviewer')).toBe('claude:opus');
  });
});

describe('changing a setting', () => {
  it('sends the patch as one settings change, with the confirmation it is given', async () => {
    const spies = spyOnCommands();
    await updateSettings({ attentionLimit: 2 });
    await updateSettings({ autoResume: false }, 'Saved.');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'settings.change', patch: { attentionLimit: 2 } }, undefined],
      [{ type: 'settings.change', patch: { autoResume: false } }, 'Saved.'],
    ] as never);
    spies.restore();
  });
});

describe('the cost limit', () => {
  it('offers no limit and a few amounts, keeping a stored amount the list does not have', () => {
    expect(listBudgetItems(settings({ taskBudgetUsd: null })).map((item) => item.label)).toEqual([
      'No limit',
      '$1.00 per task',
      '$2.00 per task',
      '$5.00 per task',
      '$10.00 per task',
      '$20.00 per task',
    ]);
    expect(listBudgetItems(settings({ taskBudgetUsd: 5 }))).toHaveLength(6);
    expect(listBudgetItems(settings({ taskBudgetUsd: 7 })).map((item) => item.value)).toEqual([
      'off',
      '1',
      '2',
      '5',
      '7',
      '10',
      '20',
    ]);
  });

  it('round-trips the limit, with no limit as off', () => {
    expect(resolveBudgetValue(settings({ taskBudgetUsd: null }))).toBe('off');
    expect(resolveBudgetValue(settings({}))).toBe('off');
    expect(resolveBudgetValue(settings({ taskBudgetUsd: 5 }))).toBe('5');
    expect(parseBudget('off')).toBeNull();
    expect(parseBudget('5')).toBe(5);
  });
});

describe('the usage limit', () => {
  it('is off by default and offers shares of the weekly limit, keeping a stored share', () => {
    expect(resolveUsageLimitValue(settings())).toBe('off');
    expect(listUsageLimitItems(settings()).map((item) => item.label)).toEqual([
      'No limit',
      '5% of the weekly limit',
      '10% of the weekly limit',
      '20% of the weekly limit',
      '30% of the weekly limit',
      '50% of the weekly limit',
    ]);
    expect(listUsageLimitItems(settings({ taskUsageLimit: 10 }))).toHaveLength(6);
    expect(listUsageLimitItems(settings({ taskUsageLimit: 15 })).map((item) => item.value)).toEqual([
      'off',
      '5',
      '10',
      '15',
      '20',
      '30',
      '50',
    ]);
    expect(resolveUsageLimitValue(settings({ taskUsageLimit: 15 }))).toBe('15');
    expect(parseUsageLimit('off')).toBeNull();
    expect(parseUsageLimit('20')).toBe(20);
  });

  const weekly = createAccount({
    id: 'weekly',
    usage: {
      status: 'ok',
      windows: [
        { id: 'seven_day', kind: 'weekly', label: 'Weekly', model: null, usedPercent: 10, resetsAt: null },
      ],
      detail: null,
      checkedAt: 1,
      source: 'read',
    },
  });
  const keyed: AccountSummary = createAccount({ id: 'api' });
  const rate = (trusted: boolean): UsageRate => ({ percentPerUsd: 0.2, tasks: 5, trusted });
  const learned = new Map([['account:weekly', rate(true)]]);

  it('shows the cost limit while it is on, when no account reports a weekly limit, or while one is learning', () => {
    expect(needsCostLimit(settings(), [weekly, keyed], learned)).toBe(false);
    expect(needsCostLimit(settings({ taskBudgetUsd: 5 }), [weekly], learned)).toBe(true);
    expect(needsCostLimit(settings(), [keyed], learned)).toBe(true);
    expect(needsCostLimit(settings(), [], null)).toBe(true);
    expect(needsCostLimit(settings(), null, learned)).toBe(false);
    expect(needsCostLimit(settings(), [weekly], new Map([['account:weekly', rate(false)]]))).toBe(true);
    expect(needsCostLimit(settings(), [weekly], new Map())).toBe(true);
    expect(needsCostLimit(settings(), [weekly], null)).toBe(false);
  });

  it('says the usage limit is an estimate on a learning account, only while no cost limit holds instead', () => {
    const usageOnly = settings({ taskUsageLimit: 10 });
    expect(describeUsageLimitNote(usageOnly, [weekly], new Map())).toBe(
      'While Shinsa learns an account’s rate, the usage limit counts an early estimate, and nothing before the first measured step. A cost limit holds from the start.'
    );
    expect(describeUsageLimitNote(usageOnly, [weekly], learned)).toBeNull();
    expect(
      describeUsageLimitNote(settings({ taskUsageLimit: 10, taskBudgetUsd: 5 }), [weekly], null)
    ).toBeNull();
    expect(describeUsageLimitNote(settings(), [weekly], new Map())).toBeNull();
    expect(describeUsageLimitNote(usageOnly, null, new Map())).toBeNull();
  });
});

describe('agents by what they do', () => {
  const providers: AgentProviderInfo[] = [
    {
      id: 'claude',
      label: 'Claude',
      models: [
        { id: 'opus', label: 'Opus 5.5', description: '' },
        { id: 'sonnet', label: 'Sonnet 5', description: '' },
      ],
    },
    { id: 'codex', label: 'Codex', models: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra', description: '' }] },
  ];
  const [work, quick] = AGENT_GROUPS as [AgentGroup, AgentGroup];

  it('shows one model for a group whose roles agree, every provider’s models grouped by provider', () => {
    expect(resolveGroupModel(settings(), work)).toBe('claude:opus');
    expect(
      listGroupModelItems(providers, settings(), work).map((item) => [item.value, item.group, item.icon])
    ).toEqual([
      ['claude:opus', 'Claude', 'IconClaudeai'],
      ['claude:sonnet', 'Claude', 'IconClaudeai'],
      ['codex:gpt-6-astra', 'Codex', 'IconOpenaiCodex'],
    ]);
  });

  it('reads a group whose roles differ, by model or by provider, as set per role', () => {
    const models = settings({ agentModels: { agent: 'sonnet' } });
    expect(resolveGroupModel(models, work)).toBe(MIXED_VALUE);
    expect(listGroupModelItems(providers, models, work).map((item) => item.label)).toEqual([
      'Set per role',
      'Opus 5.5',
      'Sonnet 5',
      'GPT-6-Astra',
    ]);
    expect(resolveGroupModel(settings({ agentProviders: { answerer: 'codex' } }), work)).toBe(MIXED_VALUE);
    expect(resolveGroupModel(settings(), quick)).toBe('claude:sonnet');
  });

  it('patches a pick, provider and model together, for every role in the group, keeping the other roles', () => {
    const current = settings({ agentModels: { writer: 'haiku' } });
    expect(resolveGroupModelPatch(current, work, 'codex:gpt-6-astra')).toEqual({
      agentProviders: { agent: 'codex', reviewer: 'codex', answerer: 'codex' },
      agentModels: {
        writer: 'haiku',
        agent: 'gpt-6-astra',
        reviewer: 'gpt-6-astra',
        answerer: 'gpt-6-astra',
      },
    });
    expect(resolveGroupModelPatch(current, quick, 'claude:opus')).toEqual({
      agentProviders: { classifier: 'claude', writer: 'claude' },
      agentModels: { writer: 'opus', classifier: 'opus' },
    });
    expect(resolveGroupModelPatch(current, work, MIXED_VALUE)).toBeNull();
  });
});

describe('models per role', () => {
  const providers: AgentProviderInfo[] = [
    {
      id: 'claude',
      label: 'Claude',
      models: [
        { id: 'opus', label: 'Opus 5.5', description: 'Most capable' },
        { id: 'sonnet', label: 'Sonnet 5', description: 'Fast' },
      ],
    },
    { id: 'codex', label: 'Codex', models: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra', description: '' }] },
  ];

  it('lists every provider’s models, with the provider as the group and its icon', () => {
    expect(listAgentModelItems(providers, 'codex:gpt-6-astra').at(-1)).toEqual({
      value: 'codex:gpt-6-astra',
      label: 'GPT-6-Astra',
      icon: 'IconOpenaiCodex',
      group: 'Codex',
    });
  });

  it('puts a current model the catalog does not know first in its provider’s group, by its display name', () => {
    const items = listAgentModelItems(providers, 'codex:gpt-5.6-sol');
    expect(items.map((item) => item.value)).toEqual([
      'claude:opus',
      'claude:sonnet',
      'codex:gpt-5.6-sol',
      'codex:gpt-6-astra',
    ]);
    expect(items[2]).toEqual({
      value: 'codex:gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      icon: 'IconOpenaiCodex',
      group: 'Codex',
    });
    expect(listAgentModelItems(providers, 'cursor:m')[0]).toEqual({
      value: 'cursor:m',
      label: 'M',
      icon: 'IconRobot',
      group: 'cursor',
    });
  });

  it('patches a role’s provider and model together, and only that role', () => {
    const current = settings({ agentProviders: { answerer: 'codex' }, agentModels: { agent: 'sonnet' } });
    expect(resolveAgentModelPatch(current, 'reviewer', 'codex:gpt-5.6-sol')).toEqual({
      agentProviders: { answerer: 'codex', reviewer: 'codex' },
      agentModels: { agent: 'sonnet', reviewer: 'gpt-5.6-sol' },
    });
  });
});

describe('resolveSectionId', () => {
  it('turns a group title into an anchor id', () => {
    expect(resolveSectionId('Appearance')).toBe('settings-appearance');
  });

  it('finds the section a link names after the hash', () => {
    expect(resolveHashSectionId('#schedules')).toBe('settings-schedules');
    expect(resolveHashSectionId('')).toBeNull();
  });

  it('turns a title of several words into one anchor, and a link finds it in any case', () => {
    expect(resolveSectionId('Repository folders')).toBe('settings-repository-folders');
    expect(resolveHashSectionId('#repository-folders')).toBe('settings-repository-folders');
    expect(resolveHashSectionId('#Accounts')).toBe('settings-accounts');
    expect(resolveHashSectionId('#models')).toBe('settings-models');
  });
});

describe('idle compaction', () => {
  it('offers never or how long before the cache expires, keeping a stored value', () => {
    const base = createSettings();
    expect(listCompactionItems(base).map((item) => item.label)).toEqual([
      'Never',
      '1 minute before the cache expires',
      '2 minutes before the cache expires',
      '5 minutes before the cache expires',
      '10 minutes before the cache expires',
    ]);
    expect(resolveCompactionValue(base)).toBe('off');
    expect(resolveCompactionValue({ ...base, compaction: 'claude', idleCompaction: true })).toBe('2');
    const odd = { ...base, compactionLeadMinutes: 7 };
    expect(listCompactionItems(odd).map((item) => item.value)).toEqual(['off', '1', '2', '5', '7', '10']);
    expect(resolveCompactionValue({ ...base, idleCompaction: false })).toBe('off');
  });

  it('turns a choice into a settings patch', () => {
    expect(parseCompaction('off')).toEqual({ idleCompaction: false });
    expect(parseCompaction('5')).toEqual({ idleCompaction: true, compactionLeadMinutes: 5 });
  });
});

describe('compaction and fast mode', () => {
  it('offers Eunoe’s two modes, Claude Code’s compaction and off', () => {
    expect(COMPACTION_MODE_ITEMS.map((item) => [item.value, item.label])).toEqual([
      ['eunoe_compact', 'Eunoe compaction'],
      ['eunoe_default', 'Eunoe always fold'],
      ['claude', 'Claude Code’s compaction'],
      ['off', 'Off'],
    ]);
  });

  it('holds fast mode back where it needs usage credits, and shows why', () => {
    const work = AGENT_GROUPS[0] as AgentGroup;
    const fast: Settings = { ...createSettings(), fastMode: true };
    const credits = (fastMode: FastModeAvailability) => ({
      ...createAccount({ id: fastMode }).usage,
      fastMode,
    });
    const without = createSnapshot({
      accounts: [createAccount({ id: 'a', usage: credits('needs_credits') })],
    });
    const withCredits = createSnapshot({
      accounts: [createAccount({ id: 'b', usage: credits('available') })],
    });
    expect(resolveSpeedAvailability(without, fast, ['agent'])).toBe('needs_credits');
    expect(resolveSpeedAvailability(withCredits, fast, ['agent'])).toBe('available');
    expect(resolveSpeedAvailability(null, fast, ['agent'])).toBe('unknown');
    expect(resolveSpeedAvailability(without, fast, [])).toBe('unknown');
    const onCodex: Settings = { ...fast, agentProviders: { reviewer: 'codex' } };
    const codexCredits = createSnapshot({
      accounts: without.accounts,
      providers: [createProviderLogin({ usage: credits('available') })],
    });
    expect(resolveSpeedAvailability(codexCredits, onCodex, ['reviewer', 'agent'])).toBe('available');
    expect(listSpeedItems('needs_credits')).toEqual([
      { value: 'off', label: 'Standard', icon: 'IconSpeedMiddle' },
      { value: 'on', label: 'Fast', icon: 'IconSpeedHigh', disabled: FAST_MODE_UNAVAILABLE },
    ]);
    expect(FAST_MODE_UNAVAILABLE).toBe('Unavailable: needs usage credits');
    expect(listSpeedItems('unknown')).toBe(FAST_MODE_ITEMS);
    expect(resolveSpeedValue(fast, 'agent', 'needs_credits')).toBe('off');
    expect(resolveSpeedValue(fast, 'agent', 'available')).toBe('on');
    expect(resolveGroupSpeed(fast, work, 'needs_credits')).toBe('off');
    expect(listGroupSpeedItems(fast, work, 'needs_credits')).toEqual(listSpeedItems('needs_credits'));
  });

  it('runs every role at standard speed until you pick fast for a group or a role', () => {
    const [work, quick] = AGENT_GROUPS as [AgentGroup, AgentGroup];
    expect(FAST_MODE_ITEMS.map((item) => item.label)).toEqual(['Standard', 'Fast']);
    const chosen: Settings = { ...createSettings(), agentFastModes: { agent: true } };
    expect(resolveSpeedValue(createSettings(), 'agent')).toBe('off');
    expect(resolveSpeedValue(chosen, 'agent')).toBe('on');
    expect(resolveGroupSpeed(createSettings(), work)).toBe('off');
    expect(resolveGroupSpeed(chosen, work)).toBe(MIXED_VALUE);
    expect(listGroupSpeedItems(chosen, work).map((item) => item.label)).toEqual([
      'Set per role',
      'Standard',
      'Fast',
    ]);
    expect(listGroupSpeedItems(createSettings(), quick)).toBe(FAST_MODE_ITEMS);
    expect(resolveGroupSpeedPatch(chosen, work, MIXED_VALUE)).toBeNull();
    expect(resolveGroupSpeedPatch(chosen, quick, 'on')).toEqual({
      agentFastModes: { agent: true, classifier: true, writer: true },
    });
    expect(resolveAgentSpeedPatch(chosen, 'reviewer', 'off')).toEqual({
      agentFastModes: { agent: true, reviewer: false },
    });
  });
});

describe('repository folders', () => {
  it('adds, removes and toggles a folder, saying which it did', () => {
    expect(resolveRootAdded(['/a'], ' /b ')).toEqual({ roots: ['/a', '/b'], done: 'Folder added.' });
    expect(resolveRootRemoved(['/a', '/b'], '/a')).toEqual({ roots: ['/b'], done: 'Folder removed.' });
    expect(resolveRootToggled(['/a'], '/a')).toEqual({ roots: [], done: 'Folder removed.' });
    expect(resolveRootToggled(['/a'], '/b')).toEqual({ roots: ['/a', '/b'], done: 'Folder added.' });
  });
});

describe('agent selects', () => {
  it('names a group’s selects the way ⌘K does, and a role’s by the role', () => {
    const doing = AGENT_GROUPS[0] as (typeof AGENT_GROUPS)[number];
    expect(describeGroupSelects(doing)).toEqual({
      model: 'Model for task agents',
      speed: 'Speed for task agents',
    });
    expect(describeRoleSelects(doing.roles[0] as (typeof doing.roles)[number])).toEqual({
      model: 'Agent model',
      speed: 'Agent speed',
    });
  });
});

describe('the watchdog settings', () => {
  it('offer how long, the first check and the longest gap, with the current value always among the choices', () => {
    const [hours, first, gap] = WATCHDOG_SETTING_FIELDS;
    if (!hours || !first || !gap) throw new Error('missing watchdog settings');
    expect(resolveWatchdogSettingValue(hours, settings({}))).toBe('72');
    expect(listWatchdogSettingItems(first, settings({})).map((item) => item.label)).toEqual([
      '10 minutes',
      '15 minutes',
      '30 minutes',
      '60 minutes',
    ]);
    expect(
      listWatchdogSettingItems(gap, settings({ watchdogMaxGapHours: 3 })).map((item) => item.label)
    ).toEqual(['1 hour', '2 hours', '3 hours', '4 hours', '6 hours', '12 hours']);
    expect(resolveWatchdogSettingValue(gap, settings({ watchdogMaxGapHours: 3 }))).toBe('3');
  });
});
