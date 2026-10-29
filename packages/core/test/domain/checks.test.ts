import { describe, expect, test } from 'bun:test';
import {
  isBlockingCheck,
  isWholeSuiteCommand,
  listBlockingChecks,
  listPhaseChecks,
  listRepoChecks,
  listTaskChecks,
  resolveNextCheckId,
} from '../../src/index.ts';
import type { ReportCheck, TaskCheck } from '../../src/report/types.ts';

const CHECKS: TaskCheck[] = [
  { id: 'c1', label: 'Parser tests', command: 'bun test src/parser', phases: [1, 2], source: 'plan' },
  { id: 'c4', label: 'Cache tests', command: 'bun test src/cache', phases: [2], source: 'agent' },
];

function result(id: string, outcome: ReportCheck['outcome'], note?: ReportCheck['note']): ReportCheck {
  return { id, label: id, command: id, outcome, detail: null, ...(note ? { note } : {}) };
}

describe('isWholeSuiteCommand', () => {
  test('a bare suite runner is the whole suite, any scope makes it a check', () => {
    for (const command of [
      'bun test',
      'npm test',
      ' bun   run test ',
      'pnpm test',
      'yarn test',
      'bunx vitest',
      'npx vitest run',
      'jest',
      'pytest',
      'python3 -m pytest',
      'uv run pytest',
      'go test ./...',
      'cargo test',
      'make test',
      'bun run check',
      'npm run ci',
    ]) {
      expect(isWholeSuiteCommand(command), command).toBe(true);
    }
    for (const command of [
      'bun test apps/engine/test/agents/transcripts',
      'bun run --cwd apps/web check-types',
      'bunx biome check apps/web/src/lib/tasks',
      'pytest tests/test_parser.py',
      'go test ./internal/parser/...',
      'cargo test parser',
      'bun run check-types',
    ]) {
      expect(isWholeSuiteCommand(command), command).toBe(false);
    }
  });

  test('a whole suite is found inside redirects, pipes, chains, wrappers and options', () => {
    for (const command of [
      'bun run test > /tmp/loc11-engine-test.log 2>&1; echo exit $?; grep -n fail /tmp/loc11-engine-test.log',
      'bun test --randomize',
      'bunx turbo run test --force',
      'turbo test',
      'npx vitest run --coverage',
      'jest --ci',
      'pytest -x -q',
      'go test -race ./...',
      'cargo test -- --nocapture',
      'cd apps/engine && bun run test',
      'bun --cwd apps/engine run test',
      'bun run --cwd=apps/engine test',
      'npm --prefix apps/web test',
      'make -C apps test',
      'timeout 600 bun run test',
      'timeout -s KILL 60 bun test',
      'nice -n 10 bun test',
      'CI=1 FORCE_COLOR=0 bun test',
      'env -i CI=1 bun test',
      'bash -lc "cd apps/web && bun test"',
      "/bin/zsh -lc 'bun test'",
      '/usr/bin/env CI=1 bun run test',
      '(cd apps && bun test)',
      'bun test 2>&1 | tail -50',
      'bun test &>/tmp/out.log',
      'bun test --timeout 5000',
      'echo $(bun test)',
      'echo `bun test`',
      'bun lint || bun run test',
      'bun test &',
    ]) {
      expect(isWholeSuiteCommand(command), command).toBe(true);
    }
    for (const command of [
      'bun test --cwd apps/engine test/checks',
      'bun run test src/onboarding',
      'bun test -t "silence note"',
      'bun test src/a > /tmp/out.log 2>&1 | tail -5',
      'timeout 600 bun test test/agents',
      'vitest run src/foo.test.ts',
      'pytest -k parser',
      'npm test -- src/parser',
      'grep -rn "bun test" docs',
      "/bin/zsh -lc 'bun test src/a.test.ts'",
      'echo test',
      'timeout',
      'constructor',
    ]) {
      expect(isWholeSuiteCommand(command), command).toBe(false);
    }
  });
});

describe('the task’s checks', () => {
  test('the repository’s commands are the baseline, numbered after the task’s, covering no phase', () => {
    expect(listRepoChecks({ checkCommands: ['bun lint'] })).toEqual([
      { id: 'r1', label: 'bun lint', command: 'bun lint', phases: [], source: 'repo' },
    ]);
    expect(listRepoChecks(null)).toEqual([]);
    expect(
      listTaskChecks({ checks: CHECKS }, { checkCommands: ['bun lint'] }).map((check) => check.id)
    ).toEqual(['c1', 'c4', 'r1']);
    expect(listTaskChecks({}, null)).toEqual([]);
  });

  test('a phase’s checks are the ones covering it', () => {
    expect(listPhaseChecks({ checks: CHECKS }, 1).map((check) => check.id)).toEqual(['c1']);
    expect(listPhaseChecks({ checks: CHECKS }, 2).map((check) => check.id)).toEqual(['c1', 'c4']);
    expect(listPhaseChecks({}, 1)).toEqual([]);
  });

  test('a new check takes the next number after the highest', () => {
    expect(resolveNextCheckId({ checks: CHECKS })).toBe('c5');
    expect(resolveNextCheckId({})).toBe('c1');
  });

  test('only a failure the change caused blocks', () => {
    expect(isBlockingCheck(result('c1', 'fail'))).toBe(true);
    expect(isBlockingCheck(result('c1', 'fail', 'fails_on_base'))).toBe(false);
    expect(isBlockingCheck(result('c1', 'pass', 'passed_alone'))).toBe(false);
    expect(isBlockingCheck(result('c1', 'skipped'))).toBe(false);
    const checkResults = [result('c1', 'fail'), result('c2', 'fail', 'fails_on_base'), result('c3', 'pass')];
    expect(listBlockingChecks({ checkResults }).map((check) => check.id)).toEqual(['c1']);
    expect(listBlockingChecks({ checkResults: null })).toEqual([]);
  });
});
