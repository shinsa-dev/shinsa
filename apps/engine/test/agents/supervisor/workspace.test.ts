import { describe, expect, test } from 'bun:test';
import { createState, SHAPE_PIPELINES } from '@shinsa/core';
import { SCRATCH_BRANCH } from '../../../src/agents/supervisor/schema.ts';
import { resolveWorkspace } from '../../../src/agents/supervisor/workspace.ts';
import { resolveScratchPath } from '../../../src/config/index.ts';
import { createTestConfig } from '../../helpers/index.ts';
import { createRepo, createRun, createTask } from '../../helpers/state.ts';

const config = createTestConfig();
const repo = createRepo();
const state = { ...createState(), repos: { [repo.id]: repo } };
const scratch = {
  cwd: resolveScratchPath(config.dataDir, 'task-1'),
  repo: null,
  defaultBranch: SCRATCH_BRANCH,
};

describe('resolveWorkspace', () => {
  test('runs a lead bound to a repository in its scratch folder, without a worktree', () => {
    const lead = createTask({ pipeline: [...SHAPE_PIPELINES.lead], worktreePath: null, branch: null });
    expect(resolveWorkspace(state, config, createRun({ purpose: 'lead' }), lead)).toEqual(scratch);
    expect(resolveWorkspace(state, config, createRun({ purpose: 'plan' }), lead)).toEqual(scratch);
  });

  test('runs a task with no repository in its scratch folder', () => {
    const task = createTask({ repoId: null, worktreePath: null });
    expect(resolveWorkspace(state, config, createRun(), task)).toEqual(scratch);
  });

  test('runs a change in its worktree, and finds none when it has not been set up', () => {
    const run = createRun();
    expect(resolveWorkspace(state, config, run, createTask())).toEqual({
      cwd: '/wt/task-1',
      repo,
      defaultBranch: 'main',
    });
    expect(resolveWorkspace(state, config, run, createTask({ worktreePath: null }))).toBeNull();
  });
});
