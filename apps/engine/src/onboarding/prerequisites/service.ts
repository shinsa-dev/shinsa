import { Context, Effect, Layer } from 'effect';
import type { CommandResult } from '../../shell/index.ts';
import { SetupCommands } from '../commands/service.ts';
import {
  PREREQUISITE_TIMEOUT_MS,
  type Prerequisite,
  type PrerequisiteId,
  type PrerequisiteNeeds,
  type PrerequisiteReport,
} from '../schema.ts';
import {
  COMMANDS,
  FIXES,
  GITHUB_SIGN_IN,
  GITHUB_SIGN_IN_FIX,
  LABELS,
  MISSING_TOOLS,
  NOT_FOUND_CODE,
  OPTIONAL_BUN_FIX,
} from './schema.ts';

export class Prerequisites extends Context.Service<
  Prerequisites,
  {
    readonly resolve: (cwd: string, needs: PrerequisiteNeeds) => Effect.Effect<PrerequisiteReport>;
  }
>()('shinsa/engine/onboarding/prerequisites/Prerequisites') {
  static readonly layer = Layer.effect(
    Prerequisites,
    Effect.gen(function* () {
      const commands = yield* SetupCommands;
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

      const resolve = Effect.fn('Prerequisites.resolve')(function* (cwd: string, needs: PrerequisiteNeeds) {
        const run = (command: string[]) => commands.run(command, cwd, { timeoutMs: PREREQUISITE_TIMEOUT_MS });
        const [git, brew, gh, ghAuth, claude, bun] = yield* Effect.all(
          [
            run(['git', '--version']),
            run(['brew', '--version']),
            run(['gh', '--version']),
            run(['gh', 'auth', 'status']),
            run(['claude', '--version']),
            run(['bun', '--version']),
          ],
          { concurrency: 'unbounded' }
        );
        const tools = [
          resolveGithubCheck(gh, ghAuth),
          createCheck('claude', claude.ok, describeOutcome(claude), false),
          createCheck(
            'bun',
            bun.ok,
            describeOutcome(bun),
            !needs.bun,
            needs.bun ? FIXES.bun : OPTIONAL_BUN_FIX
          ),
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

      return Prerequisites.of({ resolve });
    })
  );
}
