import { Effect, Option } from 'effect';
import type { Engine } from '../../apps/engine/test/helpers/engine.ts';
import {
  isTaskSettled,
  resolveFirstName,
  resolveTaskProject,
  type ShinsaState,
  type Task,
} from '../../packages/core/src/index.ts';
import type { StartedMachine } from './machine.ts';
import {
  GUEST,
  HANDOFF_FRESH,
  HANDOFF_LINK_TIMEOUT,
  HOST,
  ORIGIN,
  SANDBOX_PATH,
  SandboxFailed,
  SIGN_IN_AS,
  TEAMMATE,
  USER,
} from './schema.ts';
import { respondSignInAs } from './session.ts';
import { TEAM } from './team.ts';

const waitForHandoffLink = Effect.fn('Sandbox.waitForHandoffLink')(function* (
  engine: Engine,
  taskId: string
) {
  const select = (state: ShinsaState) =>
    state.tasks[taskId]?.handoff?.url ?? state.tasks[taskId]?.handoff?.failure;
  return yield* Effect.callback<string>((resume) => {
    const stop = engine.subscribe((state) => {
      const link = select(state);
      if (link) resume(Effect.succeed(link));
    });
    const now = select(engine.state);
    if (now) resume(Effect.succeed(now));
    return Effect.sync(stop);
  }).pipe(
    Effect.timeoutOrElse({
      duration: HANDOFF_LINK_TIMEOUT,
      orElse: () => Effect.fail(new SandboxFailed({ message: 'The hand-off link did not come.' })),
    })
  );
});

function resolveClaimAs(claim: string) {
  if (!claim.startsWith('http')) return claim;
  const link = new URL(claim);
  const back = `${link.pathname}${link.hash}`;
  return `${ORIGIN}${SANDBOX_PATH}/as/${GUEST.login}?return=${encodeURIComponent(back)}`;
}

const respondFreshHandoff = Effect.fn('Sandbox.respondFreshHandoff')(function* (
  engine: Engine,
  handle: string
) {
  const { core } = engine;
  const task = Object.values((yield* core.state).tasks).find((entry) => entry.handle === handle);
  if (!task) return new Response(`No task ${handle} on Studio.`, { status: 404 });
  if (task.handoff) yield* core.dispatch({ type: 'handoff.remove', taskId: task.id });
  yield* core.dispatch({ type: 'task.hand_off', taskId: task.id });
  const link = yield* waitForHandoffLink(engine, task.id);
  if (!link.startsWith('http')) return new Response(link, { status: 503 });
  return respondSignInAs(GUEST.login, new URL(resolveClaimAs(link)));
});

export function respondSandboxSignIn(url: URL, engine: Engine) {
  const fresh = HANDOFF_FRESH.exec(url.pathname);
  if (fresh) return respondFreshHandoff(engine, fresh[1] ?? '');
  const as = SIGN_IN_AS.exec(url.pathname);
  return as ? Effect.sync(() => respondSignInAs(as[1] ?? '', url)) : null;
}

export const createPreviewHandoffs = Effect.fn('Sandbox.createPreviewHandoffs')(function* (
  studio: StartedMachine
) {
  const { engine } = studio;
  const { core } = engine;
  const [claimed, waiting] = Object.values((yield* core.state).tasks).filter(
    (task) =>
      task.handle && task.repoId && !task.share && !task.backlog && !task.watchHome && !isTaskSettled(task)
  );
  if (!(claimed && waiting)) return [];
  yield* core.dispatch({ type: 'task.hand_off', taskId: claimed.id });
  yield* core.dispatch({ type: 'handoff.claim', taskId: claimed.id, guest: GUEST });
  yield* core.dispatch(
    { type: 'task.message', taskId: claimed.id, text: 'I have this from here. Keep going with the plan.' },
    { guest: { ...GUEST, scope: { kind: 'task', taskId: claimed.id } } }
  );
  yield* core.dispatch({ type: 'task.hand_off', taskId: waiting.id });
  const claim = yield* waitForHandoffLink(engine, waiting.id);
  const at = (task: Task) => `http://${HOST}:${studio.machine.port}/tasks/${task.handle}`;
  return [
    {
      label: `${claimed.handle}, handed off to ${resolveFirstName(GUEST)}: its banner, its facts and Activity with their message`,
      url: at(claimed),
    },
    { label: `${waiting.handle}, with a hand-off link no one opened yet`, url: at(waiting) },
    {
      label: `${waiting.handle}'s hand-off link, signed in as ${resolveFirstName(GUEST)} (open it in a private window)`,
      url: resolveClaimAs(claim),
    },
    {
      label: `A fresh hand-off link for ${waiting.handle} each time, signed in as ${resolveFirstName(GUEST)} (takes it back from whoever holds it first)`,
      url: `${ORIGIN}${SANDBOX_PATH}/handoff/${waiting.handle}`,
    },
    { label: `Sign in as ${resolveFirstName(USER)} again`, url: `${ORIGIN}${SANDBOX_PATH}/as/${USER.login}` },
  ];
});

export const createPreviewTeammateHandoff = Effect.fn('Sandbox.createPreviewTeammateHandoff')(function* (
  studio: StartedMachine,
  projectId: string | undefined
) {
  const { core } = studio.engine;
  const state = yield* core.state;
  const task = Object.values(state.tasks).find(
    (entry) =>
      entry.handle &&
      !entry.handoff &&
      !entry.backlog &&
      !entry.share &&
      !isTaskSettled(entry) &&
      Option.getOrNull(resolveTaskProject(state, entry)) === projectId
  );
  if (!task?.handle) return [];
  yield* core.dispatch({
    type: 'task.hand_to_teammate',
    taskId: task.id,
    teamId: TEAM.id,
    teammate: TEAMMATE,
  });
  const at = `http://${HOST}:${studio.machine.port}/tasks/${task.handle}`;
  return [
    {
      label: `Studio: ${task.handle}, handed to ${resolveFirstName(TEAMMATE)}, with Remove in its banner`,
      url: at,
    },
    {
      label: `The same task on the remote dashboard, where its owner sees who holds it`,
      url: `${ORIGIN}/tasks/${task.handle}`,
    },
    {
      label: `Sign in as ${resolveFirstName(TEAMMATE)} to see it in their Needs you, with Give it back`,
      url: `${ORIGIN}${SANDBOX_PATH}/as/${TEAMMATE.login}`,
    },
  ];
});
