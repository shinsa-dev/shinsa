import { describe, expect, test } from 'bun:test';
import {
  EFFECT_RECOVERY,
  PROCESS_BOUND_EFFECTS,
  REPLAY_SAFE_EFFECTS,
  resolveEffectKey,
  resolveEffectLane,
  type ShinsaEffect,
} from '../../src/index.ts';

const TASK_EFFECTS: ShinsaEffect[] = [
  { kind: 'task.triage', taskId: 't' },
  { kind: 'worktree.create', taskId: 't' },
  { kind: 'worktree.remove', taskId: 't' },
  { kind: 'scratch.remove', taskId: 't' },
  { kind: 'config.verify', taskId: 't' },
  { kind: 'pull_request.open', taskId: 't' },
  { kind: 'pull_request.push', taskId: 't' },
  { kind: 'pull_request.merge', taskId: 't', headSha: null },
  { kind: 'pull_request.watch', taskId: 't' },
];

describe('resolveEffectKey', () => {
  test('a run is executed and cancelled once, whatever event asked for it', () => {
    expect(resolveEffectKey({ kind: 'run.execute', runId: 'r' }, 1)).toBe('run.execute:r');
    expect(resolveEffectKey({ kind: 'run.execute', runId: 'r' }, 9)).toBe('run.execute:r');
    expect(resolveEffectKey({ kind: 'run.cancel', runId: 'r' }, 9)).toBe('run.cancel:r');
    expect(resolveEffectKey({ kind: 'question.resolve', gateId: 'g' }, 9)).toBe('question.resolve:g');
  });

  test('repeatable effects are keyed by the event that asked for them', () => {
    expect(resolveEffectKey({ kind: 'run.steer', runId: 'r', text: 'x' }, 4)).toBe('run.steer:r:4');
    expect(
      resolveEffectKey({ kind: 'checks.run', taskId: 't', round: 2, checks: [], coverage: false }, 4)
    ).toBe('checks.run:t:2:4');
    expect(resolveEffectKey({ kind: 'briefing.request', projectId: null }, 4)).toBe('briefing.request:*:4');
    expect(resolveEffectKey({ kind: 'briefing.request', projectId: 'a' }, 4)).toBe('briefing.request:a:4');
    expect(
      resolveEffectKey({ kind: 'watch.suggest', projectId: 'a', server: 'slack', data: 'Bugs' }, 4)
    ).toBe('watch.suggest:a:slack:4');
    for (const effect of TASK_EFFECTS) {
      expect(resolveEffectKey(effect, 4)).toBe(`${effect.kind}:t:4`);
    }
  });
});

describe('resolveEffectLane', () => {
  test('a run, its cancel and its steers each get a lane, so a cancel never waits behind its session', () => {
    expect(resolveEffectLane({ kind: 'run.execute', runId: 'r' })).toBe('run:r');
    expect(resolveEffectLane({ kind: 'run.cancel', runId: 'r' })).toBe('cancel:r');
    expect(resolveEffectLane({ kind: 'run.steer', runId: 'r', text: 'x' })).toBe('steer:r');
    expect(resolveEffectLane({ kind: 'question.resolve', gateId: 'g' })).toBe('gate:g');
    expect(resolveEffectLane({ kind: 'briefing.request', projectId: 'a' })).toBe('briefing');
    expect(resolveEffectLane({ kind: 'watch.suggest', projectId: 'a', server: 'slack', data: 'Bugs' })).toBe(
      'suggest:a'
    );
  });

  test('everything else about a task runs in order in the task lane, except the cheap watch in its side lane', () => {
    const checks: ShinsaEffect = { kind: 'checks.run', taskId: 't', round: 0, checks: [], coverage: true };
    for (const effect of [...TASK_EFFECTS, checks]) {
      expect(resolveEffectLane(effect)).toBe(effect.kind === 'pull_request.watch' ? 'side:t' : 'task:t');
    }
  });

  test('only work tied to a live process is process bound; everything else is safe to run again', () => {
    expect([...PROCESS_BOUND_EFFECTS].sort()).toEqual([
      'delegation.reply',
      'delegation.steer',
      'question.resolve',
      'run.cancel',
      'run.execute',
      'run.steer',
      'run.wake',
    ]);
    const kinds = Object.keys(EFFECT_RECOVERY) as ShinsaEffect['kind'][];
    expect([...REPLAY_SAFE_EFFECTS].sort()).toEqual(
      kinds.filter((kind) => !PROCESS_BOUND_EFFECTS.has(kind)).sort()
    );
    expect(PROCESS_BOUND_EFFECTS.size + REPLAY_SAFE_EFFECTS.size).toBe(kinds.length);
  });
});

describe('delegation effects', () => {
  test('a wake runs in the run lane after its session, a steered report in the steer lane, a reply in its own', () => {
    expect(resolveEffectLane({ kind: 'run.wake', runId: 'r', generation: 2 })).toBe('run:r');
    expect(resolveEffectLane({ kind: 'delegation.steer', runId: 'r', generation: 2 })).toBe('steer:r');
    expect(resolveEffectLane({ kind: 'delegation.reply', runId: 'c', questionId: 'q' })).toBe('reply:c');
  });

  test('each delivery generation and each answered question is its own effect', () => {
    expect(resolveEffectKey({ kind: 'run.wake', runId: 'r', generation: 2 }, 9)).toBe('run.wake:r:2');
    expect(resolveEffectKey({ kind: 'delegation.steer', runId: 'r', generation: 3 }, 9)).toBe(
      'delegation.steer:r:3'
    );
    expect(resolveEffectKey({ kind: 'delegation.reply', runId: 'c', questionId: 'q' }, 9)).toBe(
      'delegation.reply:c:q'
    );
  });
});

describe('slack effects', () => {
  const thread = { teamId: 'T1', channelId: 'C1', threadTs: '100.1' };
  const mention = {
    ...thread,
    eventId: 'Ev1',
    messageTs: '100.3',
    userId: 'U1',
    userName: 'A',
    text: '',
    permalink: null,
    thread: [],
  };

  test('a mention is read once per Slack event; posts and status edits run once per decision', () => {
    expect(resolveEffectKey({ kind: 'slack.evaluate', mention }, 9)).toBe('slack.evaluate:Ev1');
    expect(resolveEffectKey({ kind: 'slack.status', taskId: 't', thread }, 9)).toBe('slack.status:t:9');
    expect(resolveEffectKey({ kind: 'slack.post', thread, taskId: 't', post: { kind: 'result' } }, 9)).toBe(
      'slack.post:T1:C1:100.1:9'
    );
  });

  test('everything about one thread runs in order in its own lane', () => {
    const lanes = [
      resolveEffectLane({ kind: 'slack.evaluate', mention }),
      resolveEffectLane({ kind: 'slack.status', taskId: 't', thread }),
      resolveEffectLane({ kind: 'slack.post', thread, taskId: 't', post: { kind: 'forwarded' } }),
    ];
    expect(new Set(lanes)).toEqual(new Set(['slack:T1:C1:100.1']));
  });
});
