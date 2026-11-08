import { describe, expect, it } from 'bun:test';
import {
  AUTOPILOT_DEFAULTS,
  type AutopilotContact,
  createSettings,
  type MergeBlock,
  type SlackDirectoryView,
  type SlackSnapshot,
} from '@shinsa/core';
import {
  AUTOPILOT_RISK_ITEMS,
  CONTACT_PICKER_HINT,
  describeAutopilotContact,
  describeAutopilotContacts,
  describeContactPickerEmpty,
  isContactShown,
  listContactOptions,
  listSlackWorkspaceItems,
  resolveContactAddBlock,
  resolveContactWorkspace,
  resolveSlackUnavailable,
  toggleAutopilotContact,
  describeAgentReviewNote,
  isEscalationUnseen,
  listAutopilotWaitItems,
  listHandoffParagraphs,
  listTeamEscalationRows,
  resolveAutopilotFact,
  resolveAutopilotValue,
  resolveEscalationFact,
  resolveReviewRatingsView,
} from '@/lib/autopilot.ts';
import { createTask } from '../support/state.ts';

const FINDING = { severity: 'should_fix' as const, file: 'a.ts', line: 3, message: 'Name it.' };

const LINK = { teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: 1 };

const SNAPSHOT: SlackSnapshot = {
  remote: true,
  connectUrl: null,
  links: [LINK, { ...LINK, userId: 'U2' }],
  problem: null,
};

const ONCALL: AutopilotContact = { kind: 'slack_channel', teamId: 'T1', id: 'C1', name: 'oncall' };

const DIRECTORY: SlackDirectoryView = {
  teamId: 'T1',
  channels: [
    { id: 'C1', name: 'oncall' },
    { id: 'C2', name: 'eng' },
  ],
  people: [{ id: 'U7', name: 'Kai' }],
  problem: null,
};

describe('who an escalation reaches', () => {
  it('asks only while urgent changes go to the team', () => {
    expect(isContactShown({ ...AUTOPILOT_DEFAULTS, urgent: 'wait' })).toBe(false);
    expect(isContactShown({ ...AUTOPILOT_DEFAULTS, urgent: 'merge' })).toBe(false);
    expect(isContactShown({ ...AUTOPILOT_DEFAULTS, urgent: 'escalate' })).toBe(true);
    expect(isContactShown({ ...AUTOPILOT_DEFAULTS, urgent: 'escalate_then_merge' })).toBe(true);
  });

  it('says why Slack cannot be picked: an older engine, still checking, unreachable, or not connected', () => {
    const none = { snapshot: null, failure: null };
    expect(resolveSlackUnavailable(false, { snapshot: SNAPSHOT, failure: null })).toBe(
      'Update Shinsa on this machine first'
    );
    expect(resolveSlackUnavailable(true, none)).toBe('Checking Slack');
    expect(resolveSlackUnavailable(true, { snapshot: null, failure: 'No.' })).toBe(
      'Slack could not be checked'
    );
    const off = { ...SNAPSHOT, remote: false };
    expect(resolveSlackUnavailable(true, { snapshot: off, failure: null })).toBe(
      'Connect Slack in Settings → General first'
    );
    const unlinked = { ...SNAPSHOT, links: [] };
    expect(resolveSlackUnavailable(true, { snapshot: unlinked, failure: null })).toBe(
      'Connect Slack in Settings → General first'
    );
    expect(resolveSlackUnavailable(true, { snapshot: SNAPSHOT, failure: null })).toBeNull();
  });

  it('says who hears of an escalation: always the team, and Slack once it is set up', () => {
    expect(describeAutopilotContacts([], null)).toBe(
      'Your team in Needs you. Add Slack channels or teammates to tell them too.'
    );
    expect(describeAutopilotContacts([], 'Connect Slack in Settings → General first')).toBe(
      'Your team in Needs you. To tell Slack too: Connect Slack in Settings → General first.'
    );
    expect(describeAutopilotContacts([ONCALL], 'Checking Slack')).toBe(
      'Your team in Needs you, and each channel and teammate below in Slack, with the task link and why.'
    );
    expect(describeAutopilotContacts([], 'Checking Slack')).toBe(
      'Your team in Needs you. Add Slack channels or teammates to tell them too.'
    );
    expect(describeAutopilotContacts([ONCALL], 'Update Shinsa on this machine first')).toBe(
      'Your team in Needs you. Slack hears nothing until then: Update Shinsa on this machine first.'
    );
  });

  it('lets you add from Slack until it is unavailable or five are chosen', () => {
    expect(resolveContactAddBlock([], null)).toBeNull();
    expect(resolveContactAddBlock([], 'Checking Slack')).toBe('Checking Slack');
    const five = Array.from({ length: 5 }, (_, index) => ({ ...ONCALL, id: `C${index}` }));
    expect(resolveContactAddBlock(five, null)).toBe('Up to 5 in Slack');
  });

  it('picks from the workspace you chose, else the first connected one', () => {
    expect(resolveContactWorkspace(SNAPSHOT, null)).toBe('T1');
    const two = { ...SNAPSHOT, links: [LINK, { ...LINK, teamId: 'T2', teamName: 'Acme' }] };
    expect(resolveContactWorkspace(two, 'T2')).toBe('T2');
    expect(resolveContactWorkspace(two, 'T9')).toBe('T1');
    expect(resolveContactWorkspace(null, 'T2')).toBeNull();
  });

  it('lists each connected workspace once', () => {
    expect(listSlackWorkspaceItems(SNAPSHOT)).toEqual([
      { value: 'T1', label: 'Overclock', icon: 'IconSlack' },
    ]);
    expect(listSlackWorkspaceItems(null)).toEqual([]);
  });

  it('offers the channels and the people to search, the chosen ones ticked', () => {
    expect(listContactOptions(null, [])).toEqual([]);
    const groups = listContactOptions(DIRECTORY, [ONCALL]);
    expect(groups.map((group) => [group.kind, group.heading])).toEqual([
      ['slack_channel', 'Channels Shinsa is in'],
      ['slack_person', 'People'],
    ]);
    expect(groups[0]?.options.map((option) => [option.contact.id, option.chosen, option.disabled])).toEqual([
      ['C1', true, false],
      ['C2', false, false],
    ]);
    expect(groups[1]?.options[0]?.contact).toEqual({
      kind: 'slack_person',
      teamId: 'T1',
      id: 'U7',
      name: 'Kai',
    });
    expect(listContactOptions({ ...DIRECTORY, channels: [] }, []).map((group) => group.kind)).toEqual([
      'slack_person',
    ]);
  });

  it('disables the rest once five are chosen, but still lets you untick one', () => {
    const four = Array.from({ length: 4 }, (_, index) => ({ ...ONCALL, id: `X${index}` }));
    const options = listContactOptions(DIRECTORY, [...four, ONCALL]).flatMap((group) => group.options);
    expect(options.map((option) => [option.contact.id, option.disabled])).toEqual([
      ['C1', false],
      ['C2', true],
      ['U7', true],
    ]);
  });

  it('says why the search is empty: loading, Slack’s problem, or nothing matches', () => {
    expect(describeContactPickerEmpty(null)).toBe('Loading the channels and people in Slack…');
    expect(describeContactPickerEmpty({ ...DIRECTORY, problem: 'Slack could not be reached.' })).toBe(
      'Slack could not be reached.'
    );
    expect(describeContactPickerEmpty(DIRECTORY)).toContain('invite @Shinsa');
    expect(CONTACT_PICKER_HINT).toContain('Invite @Shinsa');
  });

  it('adds a channel or a person, removes it when picked again, and stops at five', () => {
    const kai = { kind: 'slack_person' as const, teamId: 'T1', id: 'U7', name: 'Kai' };
    expect(toggleAutopilotContact([], ONCALL)).toEqual([ONCALL]);
    expect(toggleAutopilotContact([ONCALL], kai)).toEqual([ONCALL, kai]);
    expect(toggleAutopilotContact([ONCALL, kai], { ...ONCALL, name: 'renamed' })).toEqual([kai]);
    const five = Array.from({ length: 5 }, (_, index) => ({ ...ONCALL, id: `C${index}` }));
    expect(toggleAutopilotContact(five, kai)).toEqual(five);
  });

  it('names each contact with its workspace when it is still connected', () => {
    expect(describeAutopilotContact(ONCALL, SNAPSHOT)).toEqual({
      title: '#oncall',
      description: 'Posts in this Slack channel in Overclock.',
      icon: 'IconHashtag',
    });
    expect(describeAutopilotContact({ ...ONCALL, kind: 'slack_person', name: 'Kai' }, null)).toEqual({
      title: 'Kai',
      description: 'Sends a direct message in Slack.',
      icon: 'IconUser',
    });
  });
});

describe('the Autopilot settings', () => {
  it('reads off by default, and on with the policy you saved', () => {
    expect(resolveAutopilotValue(createSettings())).toEqual({ policy: AUTOPILOT_DEFAULTS, enabled: 'off' });
    const settings = {
      ...createSettings(),
      autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true, merge: 'approved' as const },
    };
    expect(resolveAutopilotValue(settings)).toMatchObject({ enabled: 'on', policy: { merge: 'approved' } });
  });

  it('warns that an escalation reaches only you while no project is in a team', () => {
    const escalate = { ...AUTOPILOT_DEFAULTS, urgent: 'escalate' as const };
    const later = { ...AUTOPILOT_DEFAULTS, urgent: 'escalate_then_merge' as const };
    const merge = { ...AUTOPILOT_DEFAULTS, urgent: 'merge' as const };
    expect(isEscalationUnseen(escalate, [])).toBe(true);
    expect(isEscalationUnseen(later, [{ teamIds: [] }, {}])).toBe(true);
    expect(isEscalationUnseen(escalate, [{}, { teamIds: ['team-1'] }])).toBe(false);
    expect(isEscalationUnseen(merge, [])).toBe(false);
  });

  it('names each risk limit, and never approving is not a shield', () => {
    expect(AUTOPILOT_RISK_ITEMS.map((item) => [item.value, item.label, item.icon])).toEqual([
      ['none', 'Never', 'IconCircleX'],
      ['low', 'Low risk only', 'IconShieldCheck'],
      ['medium', 'Up to medium risk', 'IconShieldCheck'],
      ['high', 'Any risk', 'IconShieldCheck'],
    ]);
  });

  it('lists the waits in order with the one you saved, in minutes or hours', () => {
    const items = listAutopilotWaitItems({ ...AUTOPILOT_DEFAULTS, urgentWaitMinutes: 90 });
    expect(items.map((item) => item.label)).toEqual([
      '15 minutes',
      '30 minutes',
      '1 hour',
      '90 minutes',
      '2 hours',
      '4 hours',
      '8 hours',
    ]);
    expect(items[2]).toEqual({ value: '60', label: '1 hour', icon: 'IconClock' });
  });
});

describe('what the task page says', () => {
  it('describes the reviewer’s ratings, or nothing before it rated', () => {
    expect(resolveReviewRatingsView({ reviewRatings: null, autopiloted: null })).toBeNull();
    expect(
      resolveReviewRatingsView({ reviewRatings: { confidence: 'high', risk: 'low' }, autopiloted: null })
    ).toEqual({
      badges: [
        { key: 'confidence', label: 'High confidence', tone: 'green', icon: 'IconEyeSparkle' },
        { key: 'risk', label: 'Low risk', tone: 'green', icon: 'IconShieldCheck' },
      ],
      hint: 'The reviewer is confident and sees little risk, so a quick read should do.',
    });
    const careful = resolveReviewRatingsView({
      reviewRatings: { confidence: 'low', risk: 'medium' },
      autopiloted: null,
    });
    expect(careful?.badges.map((badge) => badge.tone)).toEqual(['red', 'amber']);
    expect(careful?.hint).toBe('The reviewer suggests a careful read.');
    expect(
      resolveReviewRatingsView({ reviewRatings: { confidence: 'medium', risk: 'high' }, autopiloted: null })
        ?.hint
    ).toBe('The reviewer suggests a careful read.');
    expect(
      resolveReviewRatingsView({ reviewRatings: { confidence: 'medium', risk: 'medium' }, autopiloted: null })
        ?.hint
    ).toBeNull();
    expect(
      resolveReviewRatingsView({
        reviewRatings: { confidence: 'high', risk: 'low' },
        autopiloted: { at: 1, reason: 'x' },
      })?.hint
    ).toBe('Autopilot approved it for you.');
  });

  it('says whether the review is only a signal or Autopilot approved it', () => {
    expect(describeAgentReviewNote({ findings: [], autopiloted: null })).toBe(
      'Found nothing to fix. A signal for you, never the approval.'
    );
    expect(
      describeAgentReviewNote({
        findings: [FINDING],
        autopiloted: { at: 1, reason: 'High confidence, low risk.' },
      })
    ).toBe('Found 1 should fix finding. Autopilot approved it for you.');
  });

  it('shows Approved for you and Sent to your team with Autopilot’s reason', () => {
    expect(resolveAutopilotFact({ autopiloted: { at: 1, reason: 'High confidence, low risk.' } })).toEqual({
      label: 'Approved for you',
      hint: 'Autopilot approved the review: High confidence, low risk.',
    });
    expect(resolveAutopilotFact({ autopiloted: null })).toBeNull();
    expect(
      resolveEscalationFact({
        escalation: {
          at: 1,
          reason: 'Urgent.',
          handoff: {
            waitedMinutes: 60,
            ownerActiveAt: null,
            foundBy: null,
            ratings: null,
            mergesAt: null,
            blockedBy: null,
          },
        },
      })
    ).toEqual({
      label: 'Sent to your team',
      hint: 'Autopilot sent it to your team: Urgent.',
    });
    expect(resolveEscalationFact({})).toBeNull();
  });
});

describe('teammates’ escalated tasks in Needs you', () => {
  it('names the teammate and opens their task', () => {
    const entry = {
      task: createTask({ id: 'k-1', title: 'Fix the checkout' }),
      gates: [],
      project: null,
      repo: null,
      owner: 'kai',
      ownerProfile: { name: 'Kai Lee', avatarUrl: null },
      machine: 'Studio',
      teamId: 'core',
      instanceId: 'm-kai',
    };
    expect(
      listTeamEscalationRows([
        {
          entry,
          escalation: {
            at: 5,
            reason: 'Urgent.',
            handoff: {
              waitedMinutes: 60,
              ownerActiveAt: null,
              foundBy: null,
              ratings: null,
              mergesAt: null,
              blockedBy: null,
            },
          },
        },
      ])
    ).toEqual([
      {
        key: 'm-kai k-1',
        title: 'Fix the checkout',
        summary: 'Kai’s urgent fix waited 1 hour for its merge',
        since: 5,
        path: '/teams/core/m-kai/k-1',
      },
    ]);
  });
});

const HOUR = 60 * 60 * 1000;

const FULL_HANDOFF = {
  at: 0,
  reason: 'Urgent.',
  handoff: {
    waitedMinutes: 15,
    ownerActiveAt: 0,
    foundBy: { server: 'cloudflare', shippedTaskTitle: 'Ship checkout' },
    ratings: { confidence: 'high' as const, risk: 'low' as const },
    mergesAt: 10 * HOUR,
    blockedBy: 'pre_merge_steps' as MergeBlock,
  },
};

describe('the hand-off an escalation shows', () => {
  it('tells a teammate why it reached them, what it fixes and what to do now', () => {
    expect(listHandoffParagraphs(FULL_HANDOFF, { owner: 'Kai', presence: 'offline', now: 7 * HOUR })).toEqual(
      [
        {
          label: 'Why it reached you',
          text: 'It is urgent and waited 15 minutes for Kai to merge it. Kai is offline and was last online about 7 hours ago.',
        },
        {
          label: 'What it fixes',
          text: 'A watchdog found an issue in cloudflare after “Ship checkout” shipped, and this change fixes it. The reviewer rated the fix high confidence, low risk.',
        },
        {
          label: 'What to do now',
          text: 'Review the change and merge it if your team settings let you, or reach Kai. Autopilot could not merge it: a pre-merge step is not ticked yet.',
        },
      ]
    );
  });

  it.each([
    ['self_approved', 'Kai', 'Kai approved the review by hand, so it waits for a person to merge it.'],
    ['self_approved', null, 'you approved the review by hand, so it waits for a person to merge it.'],
    ['edits_not_pushed', 'Kai', 'Kai’s edits are not pushed yet.'],
    ['edits_not_pushed', null, 'your edits are not pushed yet.'],
  ] as const)('words why Autopilot could not merge it (%s) for the reader', (blockedBy, owner, expected) => {
    const escalation = { ...FULL_HANDOFF, handoff: { ...FULL_HANDOFF.handoff, blockedBy } };
    const paragraphs = listHandoffParagraphs(escalation, { owner, presence: null, now: HOUR });
    expect(paragraphs.at(-1)?.text).toEndWith(`Autopilot could not merge it: ${expected}`);
  });

  it('tells you what your team saw, and leaves out what it does not know', () => {
    const bare = {
      ...FULL_HANDOFF,
      handoff: {
        ...FULL_HANDOFF.handoff,
        ownerActiveAt: null,
        foundBy: null,
        ratings: null,
        mergesAt: null,
        blockedBy: null,
      },
    };
    expect(listHandoffParagraphs(bare, { owner: null, presence: null, now: HOUR })).toEqual([
      {
        label: 'Why your team has it',
        text: 'It is urgent and waited 15 minutes for you to merge it, so Autopilot sent it to your team.',
      },
      { label: 'What happens now', text: 'Your teammates see it in their Needs you until it merges.' },
    ]);
    const unnamed = {
      ...bare,
      handoff: { ...bare.handoff, foundBy: { server: null, shippedTaskTitle: null } },
    };
    expect(listHandoffParagraphs(unnamed, { owner: null, presence: null, now: HOUR })[1]).toEqual({
      label: 'What it fixes',
      text: 'A watchdog found an issue, and this change fixes it.',
    });
    const seen = { ...bare, handoff: { ...bare.handoff, ownerActiveAt: 0, mergesAt: 2 * HOUR } };
    expect(listHandoffParagraphs(seen, { owner: 'Kai', presence: 'online', now: HOUR + 1 })).toEqual([
      {
        label: 'Why it reached you',
        text: 'It is urgent and waited 15 minutes for Kai to merge it. Kai is online now.',
      },
      {
        label: 'What to do now',
        text: 'Review the change and merge it if your team settings let you, or reach Kai. Autopilot merges it in 1 hour unless someone acts first.',
      },
    ]);
    expect(listHandoffParagraphs(seen, { owner: 'Kai', presence: 'away', now: 50 * HOUR })[0]?.text).toBe(
      'It is urgent and waited 15 minutes for Kai to merge it. Kai is away and was last active about 2 days ago.'
    );
    expect(listHandoffParagraphs(seen, { owner: 'Kai', presence: null, now: HOUR / 2 })[0]?.text).toBe(
      'It is urgent and waited 15 minutes for Kai to merge it. Kai was last online within the last hour.'
    );
    expect(listHandoffParagraphs(seen, { owner: 'Kai', presence: null, now: 3 * HOUR })[1]?.text).toBe(
      'Review the change and merge it if your team settings let you, or reach Kai.'
    );
    const unseen = { ...seen, handoff: { ...seen.handoff, ownerActiveAt: null } };
    expect(listHandoffParagraphs(unseen, { owner: 'Kai', presence: 'offline', now: HOUR })[0]?.text).toBe(
      'It is urgent and waited 15 minutes for Kai to merge it. Kai is offline.'
    );
    expect(listHandoffParagraphs(unseen, { owner: 'Kai', presence: null, now: HOUR })[0]?.text).toBe(
      'It is urgent and waited 15 minutes for Kai to merge it.'
    );
  });
});
