import { Effect } from 'effect';
import type { CommandResult } from '../../shell/index.ts';
import type { Prerequisite, PrerequisiteId, PrerequisiteReport } from '../schema.ts';
import {
  COMMANDS,
  FIXES,
  GITHUB_SIGN_IN,
  GITHUB_SIGN_IN_FIX,
  LABELS,
  MISSING_TOOLS,
  NOT_FOUND_CODE,
  OPTIONAL_BUN_FIX,
  type PrerequisiteDefinition,
} from './schema.ts';

export const resolvePrerequisiteReport = Effect.fn('Prerequisites.resolve')(function* (
  definition: PrerequisiteDefinition
) {
  const firstLine = (text: string) => text.split('\n')[0]?.trim() ?? '';

  const describeOutcome = (result: CommandResult) => {
    if (result.ok) return firstLine(result.stdout || result.stderr);
    if (result.timedOut) return 'It did not answer in time.';
    if (result.code === NOT_FOUND_CODE || MISSING_TOOLS.test(result.stderr)) return 'Not installed.';
    return firstLine(result.stderr || result.stdout) || `It exited with code ${result.code}.`;
  };

  const createCheck = (
    id: PrerequisiteId,
    ok: boolean,
    detail: string,
    optional: boolean,
    fix = FIXES[id]
  ): Prerequisite => ({
    id,
    label: LABELS[id],
    ok,
    detail,
    fix: ok ? null : fix,
    command: ok ? null : COMMANDS[id],
    ...(optional ? { optional: true } : {}),
  });

  const readGithubLogin = (result: CommandResult) => {
    const account = /Logged in to \S+ account (\S+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1];
    return account ? `Signed in as ${account}.` : 'Signed in.';
  };

  const resolveGithubCheck = (gh: CommandResult, auth: CommandResult): Prerequisite => {
    if (!gh.ok) return createCheck('gh', false, describeOutcome(gh), false);
    if (auth.ok) return createCheck('gh', true, readGithubLogin(auth), false);
    return {
      ...createCheck('gh', false, 'Not signed in.', false, GITHUB_SIGN_IN_FIX),
      command: GITHUB_SIGN_IN,
      signIn: true,
    };
  };

  const { needs } = definition;
  const [git, brew, gh, ghAuth, claude, bun, codex] = yield* Effect.all(
    [
      definition.run(['git', '--version']),
      definition.run(['brew', '--version']),
      definition.run(['gh', '--version']),
      definition.run(['gh', 'auth', 'status']),
      definition.run(['claude', '--version']),
      definition.run(['bun', '--version']),
      definition.run(['codex', '--version']),
    ],
    { concurrency: 'unbounded' }
  );
  const tools = [
    resolveGithubCheck(gh, ghAuth),
    createCheck('claude', claude.ok, describeOutcome(claude), false),
    createCheck('bun', bun.ok, describeOutcome(bun), !needs.bun, needs.bun ? FIXES.bun : OPTIONAL_BUN_FIX),
    createCheck('codex', codex.ok, describeOutcome(codex), true),
  ];
  const brewFor = tools.filter((check) => check.command?.startsWith('brew '));
  const checks = [
    createCheck('git', git.ok, describeOutcome(git), false),
    ...(brewFor.length > 0
      ? [
          createCheck(
            'brew',
            brew.ok,
            describeOutcome(brew),
            brewFor.every((check) => check.optional === true)
          ),
        ]
      : []),
    ...tools,
  ];
  const report: PrerequisiteReport = {
    ready: checks.every((check) => check.ok || check.optional === true),
    checks,
  };
  return report;
});
