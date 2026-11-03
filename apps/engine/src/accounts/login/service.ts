import type { AccountLogin } from '@shinsa/core';
import { Duration, Effect, Fiber, Ref } from 'effect';
import {
  type AccountLoginsDefinition,
  type AccountLoginsHandle,
  KEYCHAIN_HINT,
  type LoginFlow,
  type LoginOutcome,
  type LoginStart,
  type LoginTerminal,
  TRANSCRIPT_LIMIT,
} from './schema.ts';
import { describeTail, parseLoginUrl } from './transcript.ts';

export const makeAccountLogins = Effect.fn('AccountLogins.make')(function* (
  definition: AccountLoginsDefinition
) {
  const flows = yield* Ref.make<LoginFlow | null>(null);

  const isOver = (flow: LoginFlow) => flow.login.phase === 'done' || flow.login.phase === 'failed';

  const selectFlow = (key: object) => Effect.map(Ref.get(flows), (flow) => (flow?.key === key ? flow : null));

  const selectById = (loginId: string) =>
    Effect.map(Ref.get(flows), (flow) => (flow?.login.id === loginId ? flow : null));

  const modifyFlow = (key: object, change: (flow: LoginFlow) => LoginFlow) =>
    Ref.modify(flows, (flow): [LoginFlow | null, LoginFlow | null] => {
      if (flow?.key !== key) return [null, flow];
      const next = change(flow);
      return [next, next];
    });

  const update = Effect.fn('AccountLogins.update')(function* (key: object, patch: Partial<AccountLogin>) {
    const changed = yield* modifyFlow(key, (flow) => ({ ...flow, login: { ...flow.login, ...patch } }));
    if (changed) yield* definition.changed;
  });

  const end = Effect.fn('AccountLogins.end')(function* (key: object, patch: Partial<AccountLogin>) {
    const flow = yield* selectFlow(key);
    if (!flow || isOver(flow)) return;
    if (flow.terminal) yield* flow.terminal.kill;
    yield* update(key, patch);
    const ended = yield* selectFlow(key);
    if (ended) yield* definition.ended(ended.login);
    yield* Effect.forkDetach(Fiber.interruptAll(flow.fibers));
  });

  const read = Effect.fn('AccountLogins.read')(function* (key: object, text: string) {
    const flow = yield* modifyFlow(key, (current) => ({
      ...current,
      transcript: (current.transcript + text).slice(-TRANSCRIPT_LIMIT),
    }));
    if (flow?.login.phase !== 'starting') return;
    const url = parseLoginUrl(flow.transcript);
    if (url) yield* update(key, { phase: 'waiting', url });
  });

  const exited = Effect.fn('AccountLogins.exited')(function* (key: object, code: number) {
    const flow = yield* selectFlow(key);
    if (!flow || isOver(flow)) return;
    if (code !== 0 && !flow.codeSent)
      return yield* end(key, {
        phase: 'failed',
        message: `Claude ended the sign-in (${describeTail(flow.transcript)}).`,
      });
    yield* update(key, { phase: 'finishing' });
    const { accountId, id } = flow.login;
    const outcome = yield* definition.finish(accountId, id).pipe(
      Effect.catch((failure) => {
        const failed: LoginOutcome = {
          ok: false,
          message: `Shinsa could not check the sign-in: ${failure.message}`,
        };
        return Effect.logWarning('[Accounts] Could not check the account after signing in').pipe(
          Effect.annotateLogs({ accountId, error: failure.message }),
          Effect.as(failed)
        );
      })
    );
    if (outcome.ok)
      yield* end(key, { phase: 'done', email: outcome.email ?? flow.login.email, message: null });
    else yield* end(key, { phase: 'failed', message: outcome.message });
  });

  const watch = Effect.fn('AccountLogins.watch')(function* (key: object, terminal: LoginTerminal) {
    const { timers } = definition;
    const after = (ms: number, step: Effect.Effect<void>) =>
      Effect.forkDetach(Effect.andThen(Effect.sleep(Duration.millis(ms)), step));
    const menu = yield* after(
      timers.menuFallbackMs,
      Effect.gen(function* () {
        if ((yield* selectFlow(key))?.login.phase === 'starting') yield* terminal.write('\r');
      })
    );
    const noLink = yield* after(
      timers.urlTimeoutMs,
      Effect.gen(function* () {
        const flow = yield* selectFlow(key);
        if (flow?.login.phase !== 'starting') return;
        yield* end(key, {
          phase: 'failed',
          message: `Claude did not show a sign-in link (${describeTail(flow.transcript)}). ${KEYCHAIN_HINT}`,
        });
      })
    );
    const watchdog = yield* after(
      timers.watchdogMs,
      end(key, { phase: 'failed', message: 'The sign-in took too long, so Shinsa stopped it.' })
    );
    const exit = yield* Effect.forkDetach(
      terminal.exited.pipe(
        Effect.matchEffect({
          onFailure: (failure) => end(key, { phase: 'failed', message: failure.message }),
          onSuccess: (code) => exited(key, code),
        })
      )
    );
    yield* modifyFlow(key, (flow) => ({ ...flow, terminal, fibers: [menu, noLink, watchdog, exit] }));
  });

  const current = Effect.map(Ref.get(flows), (flow) => flow?.login ?? null);

  const start = Effect.fn('AccountLogins.start')(function* (request: LoginStart) {
    const previous = yield* Ref.get(flows);
    if (previous) yield* end(previous.key, { phase: 'failed', message: 'Another sign-in started.' });
    const key = {};
    yield* Ref.set(flows, {
      key,
      login: {
        id: yield* definition.newId,
        accountId: request.accountId,
        email: request.email,
        phase: 'starting',
        url: null,
        message: null,
        startedAt: yield* definition.now,
      },
      terminal: null,
      transcript: '',
      codeSent: false,
      fibers: [],
    });
    yield* definition.changed;
    yield* definition
      .spawn([request.claude, 'auth', 'login', '--claudeai'], {
        cwd: request.cwd,
        env: request.env,
        onData: (text) => read(key, text),
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            end(key, { phase: 'failed', message: `Claude could not start the sign-in: ${failure.message}` }),
          onSuccess: (terminal) => watch(key, terminal),
        })
      );
    return (yield* current) as AccountLogin;
  });

  const submitCode = Effect.fn('AccountLogins.submitCode')(function* (loginId: string, code: string) {
    const flow = yield* selectById(loginId);
    if (!flow?.terminal || flow.login.phase !== 'waiting') return false;
    yield* modifyFlow(flow.key, (current) => ({ ...current, codeSent: true }));
    yield* flow.terminal.write(`${code.trim()}\r`);
    yield* update(flow.key, { phase: 'finishing' });
    return true;
  });

  const cancel = Effect.fn('AccountLogins.cancel')(function* (loginId: string) {
    const flow = yield* selectById(loginId);
    if (!flow) return false;
    yield* end(flow.key, { phase: 'failed', message: 'You cancelled the sign-in.' });
    return true;
  });

  const clear = Effect.fn('AccountLogins.clear')(function* (loginId: string) {
    const flow = yield* selectById(loginId);
    if (!flow || !isOver(flow)) return;
    yield* Ref.set(flows, null);
    yield* definition.changed;
  });

  const stop = Effect.gen(function* () {
    const flow = yield* Ref.get(flows);
    if (flow) yield* end(flow.key, { phase: 'failed', message: 'Shinsa stopped.' });
  });

  const handle: AccountLoginsHandle = { current, start, submitCode, cancel, clear, stop };
  return handle;
});
