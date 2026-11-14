import { describe, expect, it } from 'bun:test';
import {
  AUTOPILOT_DEFAULTS,
  type AutopilotContact,
  type AutopilotTopic,
  createSettings,
  EMPTY_AUTOPILOT_PROFILE,
  type MergeBlock,
  type SlackDirectoryView,
  type SlackSnapshot,
} from '@shinsa/core';
import {
  AUTO_MERGE_DESCRIPTION,
  AUTO_MERGE_ITEMS,
  AUTOPILOT_GATE_ROWS,
  AUTOPILOT_LEVEL_DESCRIPTION,
  AUTOPILOT_LEVEL_ITEMS,
  listAutopilotLevelItems,
  listAutopilotReadinessRows,
  resolveAutopilotScoreView,
  CONTACT_PICKER_HINT,
  describeAutopilotContact,
  describeContactPickerEmpty,
  describeSlackTestResults,
  hasTeamProject,
  isSlackTestSent,
  isAskWaiting,
  resolveContactTestBlock,
  listContactOptions,
  listSlackWorkspaceItems,
  resolveContactAddBlock,
  resolveContactWorkspace,
  resolveSlackUnavailable,
  toggleAutopilotContact,
  describeAgentReviewNote,
  toggleAutopilotGate,
  listHandoffParagraphs,
  listTeamEscalationRows,
  listDoneForYouRows,
  resolveAutopilotFact,
  resolveAutopilotValue,
  resolveEscalationFact,
  resolveReviewRatingsView,
} from '@/lib/autopilot.ts';
import {
  createAutopilotKindsProfile,
  createAutopilotProfile,
  createGate,
  createShinsaState,
  createTask,
  NOW,
} from '../support/state.ts';

const FINDING = { severity: 'should_fix' as const, file: 'a.ts', line: 3, message: 'Name it.' };

const LINK = {
  teamId: 'T1',
  teamName: 'Overclock',
  userId: 'U1',
  userName: 'Christo',
  linkedAt: 1,
  accountId: null,
};

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
  people: [{ id: 'U7', name: 'Kai', image: 'https://avatars.slack-edge.com/kai.png' }],
  problem: null,
};

describe('who an escalation reaches', () => {
  it('knows whether a project is shared with a team, and warns while an ask reaches no one', () => {
    expect(hasTeamProject([{ teamIds: [] }, {}])).toBe(false);
    expect(hasTeamProject([{}, { teamIds: ['team-1'] }])).toBe(true);
    expect(isAskWaiting(AUTOPILOT_DEFAULTS, false)).toBe(true);
    expect(isAskWaiting(AUTOPILOT_DEFAULTS, true)).toBe(false);
    expect(isAskWaiting({ ...AUTOPILOT_DEFAULTS, contacts: [ONCALL] }, false)).toBe(false);
    expect(isAskWaiting({ ...AUTOPILOT_DEFAULTS, escalate: false }, false)).toBe(false);
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
      'Connect Slack in Settings → Cloud first'
    );
    const unlinked = { ...SNAPSHOT, links: [] };
    expect(resolveSlackUnavailable(true, { snapshot: unlinked, failure: null })).toBe(
      'Connect Slack in Settings → Cloud first'
    );
    expect(resolveSlackUnavailable(true, { snapshot: SNAPSHOT, failure: null })).toBeNull();
  });

  it('lets you send a test once Slack is ready and someone is chosen', () => {
    expect(resolveContactTestBlock([ONCALL], null)).toBeNull();
    expect(resolveContactTestBlock([], null)).toBe('Add a channel or person first');
    expect(resolveContactTestBlock([ONCALL], 'Checking Slack')).toBe('Checking Slack');
  });

  it('says the tests went out, or names the first one that did not and why', () => {
    const kai = { kind: 'slack_person' as const, teamId: 'T1', id: 'U7', name: 'Kai' };
    expect(describeSlackTestResults([{ contact: ONCALL, sent: true, problem: null }])).toBe(
      'Sent a test to Slack'
    );
    expect(isSlackTestSent([{ sent: true }, { sent: false }])).toBe(false);
    const both = [
      { contact: ONCALL, sent: true, problem: null },
      { contact: kai, sent: true, problem: null },
    ];
    expect(describeSlackTestResults(both)).toBe('Sent 2 tests to Slack');
    expect(isSlackTestSent(both)).toBe(true);
    expect(describeSlackTestResults([{ contact: ONCALL, sent: false, problem: 'Not in it.' }])).toBe(
      'Not sent to #oncall: Not in it.'
    );
    expect(describeSlackTestResults([{ contact: kai, sent: false, problem: null }])).toBe(
      'Not sent to Kai: Slack refused it.'
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
      ['slack_channel', 'Channels'],
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
      image: 'https://avatars.slack-edge.com/kai.png',
    });
    const faceless = { ...DIRECTORY, people: [{ id: 'U8', name: 'Mo' }] };
    expect(listContactOptions(faceless, [])[1]?.options[0]?.contact).not.toHaveProperty('image');
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
    expect(describeContactPickerEmpty(null)).toBe('Loading Slack…');
    expect(describeContactPickerEmpty({ ...DIRECTORY, problem: 'Slack could not be reached.' })).toBe(
      'Slack could not be reached.'
    );
    expect(describeContactPickerEmpty(DIRECTORY)).toBe('Nothing matches.');
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

  it('names each contact without a hash, and its workspace only when there are several', () => {
    expect(describeAutopilotContact(ONCALL, SNAPSHOT)).toEqual({
      title: 'oncall',
      detail: null,
      removeLabel: 'Stop posting in #oncall',
    });
    const two = { ...SNAPSHOT, links: [LINK, { ...LINK, teamId: 'T2', teamName: 'Acme' }] };
    expect(describeAutopilotContact({ ...ONCALL, kind: 'slack_person', name: 'Kai' }, two)).toEqual({
      title: 'Kai',
      detail: 'Overclock',
      removeLabel: 'Stop messaging Kai',
    });
  });
});

describe('the Autopilot settings', () => {
  it('reads off by default, and on with the policy you saved', () => {
    expect(resolveAutopilotValue(createSettings())).toEqual({ policy: AUTOPILOT_DEFAULTS, enabled: 'off' });
    const settings = {
      ...createSettings(),
      autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true, autoMerge: 'approved' as const },
    };
    expect(resolveAutopilotValue(settings)).toMatchObject({
      enabled: 'on',
      policy: { autoMerge: 'approved' },
    });
  });

  it('names how much it does alone and what Auto merge takes, each with one sentence on the level', () => {
    expect(AUTOPILOT_LEVEL_ITEMS.map((item) => [item.value, item.label])).toEqual([
      ['ask_first', 'Ask me first'],
      ['balanced', 'Balanced'],
      ['most', 'Most things'],
    ]);
    expect(AUTOPILOT_LEVEL_ITEMS.every((item) => (item.hint ?? '').endsWith('.'))).toBe(true);
    expect(AUTO_MERGE_ITEMS.map((item) => item.value)).toEqual(['off', 'low_risk', 'approved']);
  });

  it('gives every level, gate and Auto merge choice one sentence on what happens', () => {
    const sentences = [
      ...Object.values(AUTOPILOT_LEVEL_DESCRIPTION),
      ...AUTOPILOT_GATE_ROWS.map((row) => row.description),
      ...Object.values(AUTO_MERGE_DESCRIPTION),
    ];
    for (const sentence of sentences) expect(sentence).toMatch(/^[A-Z][^.]*\.$/);
  });

  it('scores nothing and suggests Balanced before it learned anything', () => {
    expect(resolveAutopilotScoreView({ autopilotProfile: EMPTY_AUTOPILOT_PROFILE }, 'balanced')).toEqual({
      score: {
        detail:
          'How often it guesses your plans, reviews and merges right, out of 100. It starts once you decide some.',
        value: 0,
        percent: '0%',
      },
      margin: null,
      suggested: {
        level: 'balanced',
        detail:
          'Balanced while it learns. Most things once the score reaches 90% and is 5 points ahead of your usual answer.',
        apply: null,
      },
      topics: null,
      followUps: null,
    });
  });

  it('names the topics you raise most and how often its follow-ups raised the same', () => {
    const tally = (topic: AutopilotTopic, total: number, recent: number) => ({
      topic,
      total,
      recent,
      at: NOW,
    });
    const profile = {
      ...EMPTY_AUTOPILOT_PROFILE,
      topics: [
        tally('security', 6, 4),
        tally('migrations', 3, 3.5),
        tally('tests', 4, 1),
        tally('docs', 1, 1),
        tally('data_loss', 2, 0.5),
      ],
      followUps: { scored: 3, matched: 2 },
    };
    const view = resolveAutopilotScoreView({ autopilotProfile: profile }, 'balanced');
    expect(view.topics).toEqual({
      detail:
        'What you raise most when you ask for changes or reply. Autopilot raises the same when it follows up for you.',
      value: 'Security, migrations, tests',
    });
    expect(view.followUps).toEqual({
      detail:
        'When you asked for changes after it would have followed up, it raised the same topic as you on 2 of 3.',
      percent: '67%',
    });
  });

  it('shows no topics or follow-ups for a profile from an engine that keeps neither', () => {
    const { topics: _topics, followUps: _followUps, ...older } = EMPTY_AUTOPILOT_PROFILE;
    const view = resolveAutopilotScoreView(
      { autopilotProfile: older as typeof EMPTY_AUTOPILOT_PROFILE },
      'balanced'
    );
    expect(view.topics).toBeNull();
    expect(view.followUps).toBeNull();
  });

  it('keeps suggesting Balanced while it agrees with you too rarely or over too few decisions', () => {
    const few = createAutopilotProfile({
      agreed: 10,
      disagreed: 0,
      unscored: 2,
      tallies: [
        { kind: 'plan', total: 3 },
        { kind: 'review', total: 8 },
        { kind: 'finding', total: 1 },
        { kind: 'merge', total: 2 },
      ],
    });
    const view = resolveAutopilotScoreView({ autopilotProfile: few }, 'ask_first');
    expect(view.score).toEqual({
      detail: 'It guessed you right on 10 of 10 so far and needs more to be sure.',
      value: 18,
      percent: '18%',
    });
    expect(view.suggested).toMatchObject({ level: 'balanced', apply: 'Use Balanced' });
    const unsure = createAutopilotProfile({
      agreed: 40,
      disagreed: 20,
      tallies: [{ kind: 'review', total: 60 }],
    });
    const unsureView = resolveAutopilotScoreView({ autopilotProfile: unsure }, 'balanced');
    expect(unsureView).toMatchObject({
      score: { detail: 'It guessed you right on 40 of 60, but not often enough lately.' },
      suggested: { level: 'balanced', apply: null },
    });
    expect(unsureView.score.value).toBeLessThan(90);
  });

  it('suggests Most things once the score reaches 90', () => {
    const sure = createAutopilotProfile({ agreed: 46, disagreed: 4 });
    const view = resolveAutopilotScoreView({ autopilotProfile: sure }, 'balanced');
    expect(view.score).toMatchObject({
      detail: 'It guessed you right on 46 of 50, the recent ones counting most.',
    });
    expect(view.score.value).toBeGreaterThanOrEqual(90);
    expect(view.score.percent).toBe(`${view.score.value}%`);
    expect(view.suggested).toEqual({
      level: 'most',
      detail: 'It agrees with you often enough to act alone on most work.',
      apply: 'Use Most things',
    });
    expect(resolveAutopilotScoreView({ autopilotProfile: sure }, 'most').suggested.apply).toBeNull();
  });

  it('says how far the score is ahead of or behind giving your usual answer every time', () => {
    const sure = resolveAutopilotScoreView(
      { autopilotProfile: createAutopilotProfile({ agreed: 46, disagreed: 4 }) },
      'balanced'
    );
    expect(sure.margin?.points).toMatch(/^\d+ points ahead$/);
    expect(sure.margin?.detail).toMatch(
      /^Giving your usual answer every time would have been right \d+% of the time\.$/
    );
    const always = createAutopilotProfile({ agreed: 0, disagreed: 0, unscored: 0 });
    expect(resolveAutopilotScoreView({ autopilotProfile: always }, 'balanced').margin).toBeNull();
    const behind = createAutopilotProfile({ agreed: 0, disagreed: 60 });
    expect(resolveAutopilotScoreView({ autopilotProfile: behind }, 'balanced').margin?.points).toMatch(
      /^\d+ points behind$/
    );
  });

  it('calls a score as good as your usual answer even, and says when it is barely ahead', () => {
    const combined = (agreedWeight: number, baseWeight: number) => ({
      ...EMPTY_AUTOPILOT_PROFILE,
      tracks: {
        ...EMPTY_AUTOPILOT_PROFILE.tracks,
        combined: { scored: 60, agreed: 57, weight: 100, agreedWeight, baseWeight, loss: 10 },
      },
    });
    const even = resolveAutopilotScoreView({ autopilotProfile: combined(95, 95) }, 'balanced');
    expect(even.margin?.points).toBe('Even');
    expect(even.score.detail).toBe(
      'It guessed you right on 57 of 60, but your usual answer does nearly as well.'
    );
    expect(even.suggested.level).toBe('balanced');
    const ahead = resolveAutopilotScoreView({ autopilotProfile: combined(95, 94) }, 'balanced');
    expect(ahead.margin?.points).toBe('1 point ahead');
  });

  it('offers Everything only once a kind of gate is ready, or when it is already your level', () => {
    const levels = (profile: typeof EMPTY_AUTOPILOT_PROFILE, level: 'balanced' | 'everything') =>
      listAutopilotLevelItems({ autopilotProfile: profile }, level).map((item) => item.value);
    expect(levels(EMPTY_AUTOPILOT_PROFILE, 'balanced')).toEqual(['ask_first', 'balanced', 'most']);
    const close = createAutopilotKindsProfile({ review: { scored: 99, agreed: 99, base: 0.5 } });
    expect(levels(close, 'balanced')).toEqual(['ask_first', 'balanced', 'most']);
    const ready = createAutopilotKindsProfile({ review: { scored: 120, agreed: 114, base: 0.85 } });
    expect(levels(ready, 'balanced')).toEqual(['ask_first', 'balanced', 'most', 'everything']);
    expect(levels(EMPTY_AUTOPILOT_PROFILE, 'everything')).toEqual([
      'ask_first',
      'balanced',
      'most',
      'everything',
    ]);
    const everything = listAutopilotLevelItems({ autopilotProfile: ready }, 'balanced').at(-1);
    expect(everything).toMatchObject({ label: 'Everything' });
    expect(everything?.hint).toMatch(/^[A-Z][^.]*\.$/);
  });

  it('lists every kind of gate with its score and what it still needs for Everything', () => {
    const profile = createAutopilotKindsProfile({
      plan: { scored: 120, agreed: 100, base: 0.8 },
      review: { scored: 120, agreed: 114, base: 0.85 },
      merge: { scored: 12, agreed: 12, base: 1 },
      proposal: { scored: 100, agreed: 95, base: 0.95 },
      finding: { scored: 100, agreed: 98, base: 0.97 },
    });
    expect(
      listAutopilotReadinessRows({ autopilotProfile: profile }).map((row) => [
        row.title,
        row.percent,
        row.ready,
        row.detail,
      ])
    ).toEqual([
      [
        'Plans',
        '83%',
        false,
        'It guessed you right on 100 of 120 plans, 3 points ahead of your usual answer. Everything needs 90% and 5 points ahead.',
      ],
      [
        'Reviews',
        '95%',
        true,
        'It guessed you right on 114 of 120 reviews, 10 points ahead of your usual answer. Ready for Everything.',
      ],
      ['Merges', '100%', false, 'It guessed you right on 12 of 12 merges. Everything needs 100 of them.'],
      [
        'Your OK',
        '95%',
        false,
        'It guessed you right on 95 of 100 proposals for your OK, even with your usual answer. Everything needs 90% and 5 points ahead.',
      ],
      ['Failed steps', '0%', false, 'It has not guessed any of your failed steps yet.'],
      [
        'Review findings',
        '98%',
        false,
        'It guessed you right on 98 of 100 review findings, 1 point ahead of your usual answer. Everything needs 90% and 5 points ahead.',
      ],
    ]);
    const behind = createAutopilotKindsProfile({ failure: { scored: 100, agreed: 90, base: 0.95 } });
    expect(listAutopilotReadinessRows({ autopilotProfile: behind })[4]?.detail).toBe(
      'It guessed you right on 90 of 100 failed steps, 5 points behind your usual answer. Everything needs 90% and 5 points ahead.'
    );
  });

  it('keeps Everything in use while the overall score suggests Most things', () => {
    const sure = createAutopilotProfile({ agreed: 46, disagreed: 4 });
    expect(resolveAutopilotScoreView({ autopilotProfile: sure }, 'everything').suggested).toMatchObject({
      level: 'most',
      apply: null,
    });
    const unsure = createAutopilotProfile({ agreed: 40, disagreed: 20 });
    expect(resolveAutopilotScoreView({ autopilotProfile: unsure }, 'everything').suggested.apply).toBe(
      'Use Balanced'
    );
  });

  it('adds or drops one gate and keeps the others', () => {
    expect(toggleAutopilotGate(['plans', 'questions', 'reviews'], 'questions', false)).toEqual([
      'plans',
      'reviews',
    ]);
    expect(toggleAutopilotGate(['plans'], 'reviews', true)).toEqual(['plans', 'reviews']);
    expect(toggleAutopilotGate(['plans', 'reviews'], 'reviews', true)).toEqual(['plans', 'reviews']);
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

  it('says a fix sent on at once is ready to merge', () => {
    const entry = {
      task: createTask({ id: 'k-2', title: 'Fix the login' }),
      gates: [],
      project: null,
      repo: null,
      owner: 'kai',
      ownerProfile: { name: 'Kai Lee', avatarUrl: null },
      machine: 'Studio',
      teamId: 'core',
      instanceId: 'm-kai',
    };
    const handoff = {
      waitedMinutes: 0,
      ownerActiveAt: null,
      foundBy: null,
      ratings: null,
      mergesAt: null,
      blockedBy: null,
    };
    const rows = listTeamEscalationRows([{ entry, escalation: { at: 5, reason: 'Urgent.', handoff } }]);
    expect(rows[0]?.summary).toBe('Kai’s urgent fix is ready to merge');
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
    const ready = { ...unseen, handoff: { ...unseen.handoff, waitedMinutes: 0 } };
    expect(listHandoffParagraphs(ready, { owner: 'Kai', presence: null, now: HOUR })[0]?.text).toBe(
      'It is urgent and ready for Kai to merge.'
    );
    expect(listHandoffParagraphs(ready, { owner: null, presence: null, now: HOUR })[0]?.text).toBe(
      'It is urgent and ready for you to merge, so Autopilot sent it to your team.'
    );
  });
});

describe('the things Autopilot did for you on Home', () => {
  const answered = { status: 'answered' as const, answeredAt: NOW, autopilotAnswer: 'Small and clear.' };
  const state = createShinsaState({
    tasks: [
      createTask({ id: 't-1', title: 'Paint the button', stage: 'merged' }),
      createTask({ id: 't-2', title: 'Ship the fix', stage: 'building' }),
    ],
    gates: [
      createGate({ id: 'g-merge', taskId: 't-1', type: 'merge', ...answered }),
      createGate({ id: 'g-plan', taskId: 't-2', type: 'plan', ...answered, answeredAt: NOW - 1 }),
      createGate({ id: 'g-question', taskId: 't-2', type: 'question', ...answered, answeredAt: NOW - 2 }),
      createGate({ id: 'g-review', taskId: 't-2', type: 'review', ...answered, answeredAt: NOW - 3 }),
      createGate({ id: 'g-seen', taskId: 't-2', type: 'review', ...answered, autopilotSeen: true }),
      createGate({ id: 'g-yours', taskId: 't-2', type: 'review', status: 'answered', answeredAt: NOW }),
    ],
  });

  it('lists each unseen gate it answered, newest first, saying what it did', () => {
    expect(listDoneForYouRows(state).map((row) => [row.gateId, row.title, row.summary, row.icon])).toEqual([
      ['g-merge', 'Paint the button', 'Autopilot merged it for you.', 'IconMerged'],
      ['g-plan', 'Ship the fix', 'Autopilot approved the plan for you.', 'IconChecklist'],
      ['g-question', 'Ship the fix', 'Autopilot answered an agent’s question for you.', 'IconBubbleCheck'],
      ['g-review', 'Ship the fix', 'Autopilot approved the review for you.', 'IconCheckCircle2'],
    ]);
    expect(listDoneForYouRows(state)[0]).toMatchObject({
      reason: 'Small and clear.',
      at: NOW,
      tone: 'green',
    });
  });

  it('says what it did on failed steps, change requests and your OK', () => {
    const done = createShinsaState({
      tasks: [
        createTask({
          id: 't-1',
          title: 'Fix the login',
          createdBy: { kind: 'watchdog', taskId: 't-2', runId: 'r', requestKey: 'k' },
        }),
        createTask({ id: 't-2', title: 'Ship the fix' }),
      ],
      gates: [
        createGate({ id: 'g-retry', taskId: 't-2', type: 'failure', decision: 'approve', ...answered }),
        createGate({ id: 'g-cancel', taskId: 't-2', type: 'failure', decision: 'reject', ...answered }),
        createGate({ id: 'g-revise', taskId: 't-2', type: 'review', decision: 'revise', ...answered }),
        createGate({ id: 'g-watchdog', taskId: 't-1', type: 'proposal', ...answered }),
        createGate({ id: 'g-ok', taskId: 't-2', type: 'proposal', ...answered }),
      ],
    });
    expect(
      Object.fromEntries(
        listDoneForYouRows(done).map((row) => [row.gateId, [row.summary, row.icon, row.tone]])
      )
    ).toEqual({
      'g-retry': ['Autopilot retried the failed step for you.', 'IconArrowRotateClockwise', 'orange'],
      'g-cancel': ['Autopilot cancelled the task after a failed step.', 'IconCircleX', 'neutral'],
      'g-revise': ['Autopilot asked for changes for you.', 'IconPencil', 'amber'],
      'g-watchdog': ['Autopilot gave your OK on a watchdog task’s fix.', 'IconCheckCircle2', 'purple'],
      'g-ok': ['Autopilot gave your OK for you.', 'IconCheckCircle2', 'purple'],
    });
  });

  it('quotes the follow-up it sent in your voice, and marks the row apart from an approval', () => {
    const followed = createShinsaState({
      tasks: [createTask({ id: 't-3', title: 'Add the endpoint', stage: 'planning' })],
      gates: ['plan', 'review', 'merge'].map((type, index) =>
        createGate({
          id: `g-${type}`,
          taskId: 't-3',
          type: type as 'plan' | 'review' | 'merge',
          ...answered,
          answeredAt: NOW - index,
          decision: 'revise',
          response: '  How does this handle auth on the new endpoint? ',
        })
      ),
    });
    expect(listDoneForYouRows(followed).map((row) => [row.summary, row.icon, row.tone])).toEqual([
      [
        'Autopilot asked for changes to the plan for you: “How does this handle auth on the new endpoint?”',
        'IconBubbleText',
        'amber',
      ],
      [
        'Autopilot asked for changes to the review for you: “How does this handle auth on the new endpoint?”',
        'IconBubbleText',
        'amber',
      ],
      [
        'Autopilot asked for changes before the merge for you: “How does this handle auth on the new endpoint?”',
        'IconBubbleText',
        'amber',
      ],
    ]);
    expect(listDoneForYouRows(followed)[0]?.reason).toBe('Small and clear.');
  });
});
