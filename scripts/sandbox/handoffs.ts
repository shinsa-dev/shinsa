import type { Engine } from '../../apps/engine/src/runtime/index.ts';
import {
  isTaskSettled,
  resolveFirstName,
  resolveTaskProject,
  type Task,
} from '../../packages/core/src/index.ts';
import type { StartedMachine } from './machine.ts';
import { GUEST, HANDOFF_FRESH, HOST, ORIGIN, SANDBOX_PATH, SIGN_IN_AS, TEAMMATE, USER } from './schema.ts';
import { respondSignInAs } from './session.ts';
import { TEAM } from './team.ts';

function waitForHandoffLink(engine: Engine, taskId: string) {
  return new Promise<string>((done) => {
    const read = () =>
      engine.state.tasks[taskId]?.handoff?.url ?? engine.state.tasks[taskId]?.handoff?.failure;
    const now = read();
    if (now) return done(now);
    const stop = engine.subscribe(() => {
      const url = read();
      if (!url) return;
      stop();
      done(url);
    });
  });
}

function resolveClaimAs(claim: string) {
  if (!claim.startsWith('http')) return claim;
  const link = new URL(claim);
  const back = `${link.pathname}${link.hash}`;
  return `${ORIGIN}${SANDBOX_PATH}/as/${GUEST.login}?return=${encodeURIComponent(back)}`;
}

async function respondFreshHandoff(engine: Engine, handle: string) {
  const task = Object.values(engine.state.tasks).find((entry) => entry.handle === handle);
  if (!task) return new Response(`No task ${handle} on Studio.`, { status: 404 });
  if (task.handoff) await engine.dispatch({ type: 'handoff.remove', taskId: task.id });
  await engine.dispatch({ type: 'task.hand_off', taskId: task.id });
  const link = await waitForHandoffLink(engine, task.id);
  if (!link.startsWith('http')) return new Response(link, { status: 503 });
  return respondSignInAs(GUEST.login, new URL(resolveClaimAs(link)));
}

export function respondSandboxSignIn(url: URL, engine: Engine) {
  const fresh = HANDOFF_FRESH.exec(url.pathname);
  if (fresh) return respondFreshHandoff(engine, fresh[1] ?? '');
  const as = SIGN_IN_AS.exec(url.pathname);
  return as ? respondSignInAs(as[1] ?? '', url) : null;
}

export async function createPreviewHandoffs(studio: StartedMachine) {
  const { engine } = studio;
  const [claimed, waiting] = Object.values(engine.state.tasks).filter(
    (task) =>
      task.handle && task.repoId && !task.share && !task.backlog && !task.watchHome && !isTaskSettled(task)
  );
  if (!(claimed && waiting)) return [];
  await engine.dispatch({ type: 'task.hand_off', taskId: claimed.id });
  await engine.dispatch({ type: 'handoff.claim', taskId: claimed.id, guest: GUEST });
  await engine.dispatch(
    { type: 'task.message', taskId: claimed.id, text: 'I have this from here. Keep going with the plan.' },
    { guest: { ...GUEST, scope: { kind: 'task', taskId: claimed.id } } }
  );
  await engine.dispatch({ type: 'task.hand_off', taskId: waiting.id });
  const claim = await waitForHandoffLink(engine, waiting.id);
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
}

export async function createPreviewTeammateHandoff(studio: StartedMachine, projectId: string | undefined) {
  const { engine } = studio;
  const task = Object.values(engine.state.tasks).find(
    (entry) =>
      entry.handle &&
      !entry.handoff &&
      !entry.backlog &&
      !entry.share &&
      !isTaskSettled(entry) &&
      resolveTaskProject(engine.state, entry) === projectId
  );
  if (!task?.handle) return [];
  await engine.dispatch({
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
}
