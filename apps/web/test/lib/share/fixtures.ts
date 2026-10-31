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
    task: createTask({ id: 'task-1', handle: 'SW-34', title: 'Rotate API keys', branch: 'feat/keys' }),
    evidence: [
      createSharedEvidence({ id: 'shot-1' }),
      createSharedEvidence({ id: 'lost' }),
      createSharedEvidence({ id: 'link', kind: 'preview', uri: 'https://preview.example.dev' }),
    ],
    project: 'Superwall',
    owner: 'mona',
    machine: 'Studio',
    repository: 'acme/app',
    code: true,
    ...overrides,
  };
}
