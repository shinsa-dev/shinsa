import type { Evidence, SharedTask } from '@shinsa/core';
import { createTask } from '../../support/state.ts';

export const DIFF = [
  'diff --git a/src/keys.ts b/src/keys.ts',
  'index 1..2 100644',
  '--- a/src/keys.ts',
  '+++ b/src/keys.ts',
  '@@ -1,2 +1,2 @@',
  ' const ttl = 24;',
  '-export const keep = false;',
  '+export const keep = true;',
  '',
].join('\n');

function createSharedEvidence(overrides: Partial<Evidence> & { id: string }): Evidence {
  return {
    taskId: 'task-1',
    runId: null,
    kind: 'screenshot',
    title: 'Settings',
    uri: `shared-evidence:${overrides.id}`,
    attachedAt: 1,
    ...overrides,
  };
}

export function createSharedTask(overrides: Partial<SharedTask> = {}): SharedTask {
  return {
    preset: 'full',
    task: createTask({
      id: 'task-1',
      handle: 'SW-34',
      title: 'Rotate API keys',
      branch: 'feat/keys',
      repoId: 'repo-1',
      projectId: 'project-1',
    }),
    gates: [
      {
        id: 'gate-1',
        taskId: 'task-1',
        type: 'merge',
        status: 'open',
        title: 'Ready to merge',
        body: '',
        runId: null,
        openedAt: 1,
        answeredAt: null,
        decision: null,
        response: null,
      },
    ],
    runs: [
      {
        id: 'run-1',
        taskId: 'task-1',
        role: 'agent',
        provider: 'claude',
        model: null,
        sessionId: null,
        startedAt: 1,
        endedAt: 2,
        outcome: 'completed',
        summary: null,
      },
    ],
    evidence: [
      createSharedEvidence({ id: 'shot-1' }),
      createSharedEvidence({ id: 'lost' }),
      createSharedEvidence({ id: 'link', kind: 'preview', uri: 'https://preview.example.dev' }),
    ],
    repo: {
      id: 'repo-1',
      name: 'app',
      path: '',
      defaultBranch: 'main',
      remote: 'git@github.com:acme/app.git',
      projectId: 'project-1',
      checkCommands: ['bun lint'],
    },
    project: { id: 'project-1', name: 'Superwall', color: 'blue', key: 'SW', description: '', folders: [] },
    owner: 'mona',
    machine: 'Studio',
    repository: 'acme/app',
    code: true,
    ...overrides,
  };
}
