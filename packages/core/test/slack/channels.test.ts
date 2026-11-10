import { describe, expect, test } from 'bun:test';
import {
  listSlackChannelSchedules,
  listSlackChannelWatches,
  resolveSlackChannelTrigger,
  SLACK_NOT_CONNECTED,
  type ScheduleTrigger,
  type SlackChannel,
} from '../../src/index.ts';
import { createHarness, createTask, type Harness } from '../harness.ts';

const ALERTS: SlackChannel = {
  teamId: 'T1',
  teamName: 'Acme',
  channelId: 'C1',
  channelName: 'alerts',
  private: false,
};

const FEEDBACK: SlackChannel = { ...ALERTS, channelId: 'G2', channelName: 'feedback', private: true };

const OTHER_ALERTS: SlackChannel = { ...ALERTS, teamId: 'T2', teamName: 'Beta Labs', channelId: 'C9' };

describe('naming a Slack channel for an automation', () => {
  test('finds it by name or id, whatever the case, and keeps its workspace', () => {
    const trigger = {
      kind: 'slack' as const,
      teamId: 'T1',
      teamName: 'Acme',
      channelId: 'C1',
      channelName: 'alerts',
    };
    expect(resolveSlackChannelTrigger([FEEDBACK, ALERTS], { channel: 'Alerts', workspace: null })).toEqual({
      trigger,
      problem: null,
    });
    expect(
      resolveSlackChannelTrigger([FEEDBACK, ALERTS], { channel: 'c1', workspace: null }).trigger
    ).toEqual(trigger);
  });

  test('asks for the workspace when two have the channel, by name or id', () => {
    const both = [ALERTS, OTHER_ALERTS];
    expect(resolveSlackChannelTrigger(both, { channel: 'alerts', workspace: null })).toEqual({
      trigger: null,
      problem: '#alerts is in several Slack workspaces: Acme, Beta Labs. Name the workspace too.',
    });
    expect(
      resolveSlackChannelTrigger(both, { channel: 'alerts', workspace: 'beta labs' }).trigger
    ).toMatchObject({ teamId: 'T2', channelId: 'C9' });
    expect(resolveSlackChannelTrigger(both, { channel: 'alerts', workspace: 't1' }).trigger).toMatchObject({
      teamId: 'T1',
    });
  });

  test('says to invite the bot when it is not in the channel', () => {
    expect(resolveSlackChannelTrigger([ALERTS], { channel: 'deploys', workspace: null }).problem).toBe(
      'Shinsa is not in #deploys. Invite @Shinsa to the channel in Slack, then set the automation again.'
    );
    expect(resolveSlackChannelTrigger([ALERTS], { channel: 'alerts', workspace: 'Gamma' }).problem).toBe(
      'Shinsa is not in #alerts in Gamma. Invite @Shinsa to the channel in Slack, then set the automation again.'
    );
  });

  test('says to connect Slack when the bot is in no channel at all', () => {
    expect(resolveSlackChannelTrigger([], { channel: 'alerts', workspace: null })).toEqual({
      trigger: null,
      problem: SLACK_NOT_CONNECTED,
    });
  });
});

describe('the channels a machine watches', () => {
  function watch(harness: Harness, taskId: string, trigger: ScheduleTrigger) {
    const { events } = harness.send({
      type: 'agent.set_schedule',
      runId: harness.activeRun(taskId).id,
      scheduleId: null,
      name: null,
      text: 'Look into it.',
      trigger,
      target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
      source: null,
      enabled: null,
      maxRuns: null,
      timeZone: 'Europe/Berlin',
    });
    const written = events.find((event) => event.type === 'schedule.written');
    if (written?.type !== 'schedule.written') throw new Error('no schedule');
    return written.schedule.id;
  }

  function slack(teamId: string, channelId: string): ScheduleTrigger {
    return { kind: 'slack', teamId, teamName: 'Acme', channelId, channelName: 'alerts' };
  }

  test('are those of its live Slack triggers, each once and in a fixed order', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const second = watch(harness, taskId, slack('T2', 'C7'));
    const first = watch(harness, taskId, slack('T1', 'C1'));
    const twin = watch(harness, taskId, slack('T1', 'C1'));
    const paused = watch(harness, taskId, slack('T1', 'C3'));
    watch(harness, taskId, { kind: 'interval', everyMinutes: 30 });
    harness.send({ type: 'schedule.enable', scheduleId: paused, enabled: false });
    expect(listSlackChannelWatches(harness.state)).toEqual([
      { teamId: 'T1', channelId: 'C1' },
      { teamId: 'T2', channelId: 'C7' },
    ]);
    const ids = (teamId: string, channelId: string) =>
      listSlackChannelSchedules(harness.state, { teamId, channelId }).map((schedule) => schedule.id);
    expect(ids('T1', 'C1')).toEqual([first, twin]);
    expect(ids('T2', 'C7')).toEqual([second]);
    expect(ids('T1', 'C3')).toEqual([]);
    expect(ids('T2', 'C1')).toEqual([]);
  });
});
