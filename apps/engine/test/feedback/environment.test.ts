import { describe, expect, test } from 'bun:test';
import { createState, type Feedback } from '@shinsa/core';
import {
  type FeedbackMachine,
  listFeedbackEnvironment,
  resolveFeedbackMachine,
  serializeFeedbackEnvironment,
} from '../../src/feedback/environment.ts';
import { createRun, createTask } from '../helpers/state.ts';

const MAC: FeedbackMachine = {
  platform: 'darwin',
  release: '25.1.0',
  arch: 'arm64',
  runtime: '1.3.4',
  bundled: true,
};

function createEntry(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'f1',
    source: 'human',
    note: 'The plan tab hides my changes.',
    title: null,
    body: null,
    status: 'drafting',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('the environment a feedback issue carries', () => {
  test('names the version, the system, the runtime and the default agent for your feedback', () => {
    const state = createState();
    state.settings.defaultProvider = 'claude';
    state.settings.defaultModel = 'claude-opus-5-5';
    expect(
      listFeedbackEnvironment(state, createEntry(), { version: '1.2.0', commit: 'abcdef1234' }, MAC)
    ).toEqual([
      'Shinsa: 1.2.0 (abcdef1), the Mac app',
      'System: macOS (Darwin 25.1.0), arm64',
      'Runtime: Bun 1.3.4',
      'Default agent: claude, claude-opus-5-5',
      'Sent by: the person using Shinsa',
    ]);
  });

  test('adds the kind of task, its stage and the agent that reported it, never its title', () => {
    const state = createState();
    state.settings.defaultModel = null;
    state.tasks.t1 = createTask({ id: 't1', title: 'Secret launch', stage: 'building' });
    state.runs.r1 = createRun({
      id: 'r1',
      taskId: 't1',
      role: 'agent',
      purpose: 'build',
      provider: 'codex',
      model: null,
    });
    const lines = listFeedbackEnvironment(
      state,
      createEntry({ source: 'agent', taskId: 't1', runId: 'r1' }),
      { version: '1.2.0', commit: null },
      { ...MAC, platform: 'linux', release: '6.8.0', bundled: false }
    );
    expect(lines).toEqual([
      'Shinsa: 1.2.0, run from source',
      'System: Linux (6.8.0), arm64',
      'Runtime: Bun 1.3.4',
      `Default agent: ${state.settings.defaultProvider}, its default model`,
      'Sent by: an agent working in Shinsa',
      'Kind of task: change',
      'Stage of the task: building',
      'Agent role: agent, working on its build step',
      'Agent provider and model: codex, its default model',
    ]);
    expect(lines.join('\n')).not.toContain('Secret launch');
  });

  test('an agent report whose run is gone keeps the task lines, and an unknown system keeps its own name', () => {
    const state = createState();
    state.tasks.t1 = createTask({ id: 't1', stage: 'planning' });
    const lines = listFeedbackEnvironment(
      state,
      createEntry({ source: 'agent', taskId: 't1', runId: 'gone' }),
      { version: '1.2.0', commit: null },
      { ...MAC, platform: 'freebsd', release: '14.1' }
    );
    expect(lines).toContain('System: freebsd (14.1), arm64');
    expect(lines).toContain('Stage of the task: planning');
    expect(lines.some((line) => line.startsWith('Agent role'))).toBe(false);
    const run = createRun({ id: 'r2', taskId: 't1', purpose: undefined });
    state.runs.r2 = run;
    expect(
      listFeedbackEnvironment(
        state,
        createEntry({ source: 'agent', taskId: 't1', runId: 'r2' }),
        { version: '1', commit: null },
        MAC
      )
    ).toContain(`Agent role: ${run.role}`);
  });

  test('reads this machine and serializes the lines as an Environment section', () => {
    expect(resolveFeedbackMachine(false)).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      bundled: false,
    });
    expect(serializeFeedbackEnvironment(['Shinsa: 1.2.0', 'Runtime: Bun 1.3.4'])).toBe(
      '### Environment\n\n- Shinsa: 1.2.0\n- Runtime: Bun 1.3.4'
    );
  });
});
