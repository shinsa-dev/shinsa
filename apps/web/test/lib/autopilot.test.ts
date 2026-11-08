import { describe, expect, it } from 'bun:test';
import {
  AUTOPILOT_DEFAULTS,
  type AutopilotSlackContact,
  createSettings,
  type MergeBlock,
  type SlackDirectoryView,
  type SlackSnapshot,
} from '@shinsa/core';
import {
  AUTOPILOT_RISK_ITEMS,
  AUTOPILOT_ROWS,
  isContactShown,
  listAutopilotContactItems,
  listSlackWorkspaceItems,
  NO_CONTACT,
  resolveContactDraft,
  resolveContactPicker,
  resolveSlackContact,
  resolveSlackUnavailable,
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

const ONCALL: AutopilotSlackContact = { kind: 'slack_channel', teamId: 'T1', id: 'C1', name: 'oncall' };

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

  it('keeps the team the default and disables the Slack choices with the reason', () => {
    expect(listAutopilotContactItems(null).map((item) => [item.value, item.label, item.disabled])).toEqual([
      ['team', 'Your team in Shinsa', undefined],
      ['slack_channel', 'Your team and a Slack channel', undefined],
      ['slack_person', 'Your team and a teammate on Slack', undefined],
    ]);
    expect(listAutopilotContactItems('Checking Slack').map((item) => item.disabled)).toEqual([
      undefined,
      'Checking Slack',
      'Checking Slack',
    ]);
  });

  it('starts a Slack choice in the saved workspace, else the first connected one', () => {
    expect(resolveContactDraft({ kind: 'team' }, {}, SNAPSHOT)).toEqual({ kind: 'team', teamId: null });
    expect(resolveContactDraft(ONCALL, { kind: 'team' }, SNAPSHOT)).toEqual({ kind: 'team', teamId: null });
    expect(resolveContactDraft(ONCALL, {}, null)).toEqual({ kind: 'slack_channel', teamId: 'T1' });
    expect(resolveContactDraft({ kind: 'team' }, { kind: 'slack_person' }, SNAPSHOT)).toEqual({
      kind: 'slack_person',
      teamId: 'T1',
    });
    expect(
      resolveContactDraft({ kind: 'team' }, { kind: 'slack_person', teamId: 'T9' }, SNAPSHOT)
    ).toMatchObject({
      teamId: 'T9',
    });
    expect(resolveContactDraft({ kind: 'team' }, { kind: 'slack_person' }, null).teamId).toBeNull();
  });

  it('lists each connected workspace once, and keeps a saved one no longer connected', () => {
    expect(listSlackWorkspaceItems(SNAPSHOT, { kind: 'team' })).toEqual([
      { value: 'T1', label: 'Overclock', icon: 'IconSlack' },
    ]);
    expect(listSlackWorkspaceItems(null, { ...ONCALL, teamId: 'T9' })).toEqual([
      { value: 'T9', label: 'T9', icon: 'IconSlack', disabled: 'Not connected any more' },
    ]);
  });

  it('offers the directory’s channels or people, with a placeholder until one is chosen', () => {
    const channel = { kind: 'slack_channel' as const, teamId: 'T1' };
    const loading = resolveContactPicker(channel, { kind: 'team' }, null);
    expect(loading).toEqual({
      items: [{ value: NO_CONTACT, label: 'Choose a channel', icon: 'IconHashtag', disabled: 'Loading' }],
      value: NO_CONTACT,
      description: AUTOPILOT_ROWS.slack_channel.description,
    });
    const loaded = resolveContactPicker(channel, { kind: 'team' }, DIRECTORY);
    expect(loaded.items.map((item) => [item.value, item.label, item.disabled])).toEqual([
      [NO_CONTACT, 'Choose a channel', 'Not chosen yet'],
      ['C1', 'oncall', undefined],
      ['C2', 'eng', undefined],
    ]);
    const person = resolveContactPicker({ kind: 'slack_person', teamId: 'T1' }, ONCALL, {
      ...DIRECTORY,
      people: [],
    });
    expect(person.items).toEqual([
      { value: NO_CONTACT, label: 'Choose a teammate', icon: 'IconUser', disabled: 'No one to message yet' },
    ]);
    expect(person.description).toBe(AUTOPILOT_ROWS.slack_person.description);
    const empty = resolveContactPicker(channel, { kind: 'team' }, { ...DIRECTORY, channels: [] });
    expect(empty.items[0]?.disabled).toBe('Shinsa is in no channel yet');
  });

  it('shows the saved contact even when the directory no longer lists it, and the directory’s problem', () => {
    const channel = { kind: 'slack_channel' as const, teamId: 'T1' };
    const saved = resolveContactPicker(channel, ONCALL, DIRECTORY);
    expect(saved.value).toBe('C1');
    expect(saved.items.map((item) => item.value)).toEqual(['C1', 'C2']);
    const gone = resolveContactPicker(
      channel,
      { ...ONCALL, id: 'C9', name: 'old' },
      {
        ...DIRECTORY,
        problem: 'Slack could not be reached.',
      }
    );
    expect(gone.items.map((item) => [item.value, item.label])).toEqual([
      ['C9', 'old'],
      ['C1', 'oncall'],
      ['C2', 'eng'],
    ]);
    expect(gone.description).toBe('Slack could not be reached.');
    const otherWorkspace = resolveContactPicker({ ...channel, teamId: 'T2' }, ONCALL, null);
    expect(otherWorkspace.value).toBe(NO_CONTACT);
  });

  it('saves the picked entry with its name, and nothing for the placeholder', () => {
    const channel = { kind: 'slack_channel' as const, teamId: 'T1' };
    const picker = resolveContactPicker(channel, { kind: 'team' }, DIRECTORY);
    expect(resolveSlackContact(channel, picker, 'C2')).toEqual({
      kind: 'slack_channel',
      teamId: 'T1',
      id: 'C2',
      name: 'eng',
    });
    expect(resolveSlackContact(channel, picker, NO_CONTACT)).toBeNull();
    expect(resolveSlackContact(channel, picker, 'C404')).toBeNull();
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
