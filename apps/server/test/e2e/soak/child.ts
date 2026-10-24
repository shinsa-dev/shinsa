import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gate, isTaskSettled, listOpenGates, type ShinsaCommand, type TaskStage } from '@shinsa/core';
import type { ModelSource } from '../../../src/agents/index.ts';
import { startShinsa } from '../../../src/serve.ts';
import { EventLog } from '../../../src/store/index.ts';
import { createConfigAt } from '../../helpers/config.ts';
import { createRandom } from '../../helpers/random.ts';
import { FakeAgents } from '../harness.ts';

const root = Bun.env.SOAK_ROOT ?? '';
const random = createRandom(Number(Bun.env.SOAK_SEED ?? 1));

const config = createConfigAt(root, { allowedHosts: ['127.0.0.1'], settleDelayMs: 30 });

const agents = new FakeAgents(() => Math.floor(random.next() * 80), join(root, 'sessions.json'));

const shinsa = await startShinsa(config, {
  startSession: agents.start,
  resolveLogin: () => Promise.resolve(null),
  models: { listModels: () => Promise.resolve([]) } as ModelSource,
  discover: () => Promise.resolve({ candidates: [], truncated: false }),
});

interface Sent {
  id: string;
  command: ShinsaCommand;
}

const outboxPath = join(root, 'client-outbox.json');

const sent: Sent[] = existsSync(outboxPath) ? JSON.parse(readFileSync(outboxPath, 'utf8')) : [];

const CANCEL_INTENT = Bun.env.SOAK_CANCEL_INTENT ?? '';

const CANCEL_STAGES: TaskStage[] = ['planning', 'building', 'checking', 'reviewing'];

const cancelAt = CANCEL_STAGES[Number(Bun.env.SOAK_CANCEL_STAGE ?? 0) % CANCEL_STAGES.length];

function send(id: string, command: ShinsaCommand) {
  if (sent.some((entry) => entry.id === id)) return;
  sent.push({ id, command });
  writeFileSync(`${outboxPath}.tmp`, JSON.stringify(sent));
  renameSync(`${outboxPath}.tmp`, outboxPath);
  shinsa.engine
    .dispatch(command, { id })
    .catch((error: unknown) => process.stderr.write(`command failed: ${id} ${String(error)}\n`));
}

function resendAll() {
  for (const entry of sent) {
    shinsa.engine
      .dispatch(entry.command, { id: entry.id })
      .catch((error: unknown) => process.stderr.write(`resend failed: ${entry.id} ${String(error)}\n`));
  }
}

function isCrashPause(gate: Gate) {
  return (
    gate.type === 'failure' && shinsa.engine.state.runs[gate.runId ?? '']?.failure?.code === 'crash_loop'
  );
}

function answerGates() {
  for (const gate of listOpenGates(shinsa.engine.state)) {
    if (gate.type === 'failure' && !isCrashPause(gate)) continue;
    const decision = gate.type === 'question' ? 'reply' : 'approve';
    send(`client:answer:${gate.id}`, {
      type: 'gate.answer',
      gateId: gate.id,
      decision,
      response: decision === 'reply' ? 'Yes.' : null,
    });
  }
}

function cancelOnCue() {
  for (const task of Object.values(shinsa.engine.state.tasks)) {
    if (task.request !== CANCEL_INTENT || task.stage !== cancelAt) continue;
    send(`client:cancel:${task.id}`, { type: 'task.cancel', taskId: task.id });
  }
}

const outbox = new EventLog(config.databasePath);

let stopping = false;

async function stopOnceSettled() {
  for (;;) {
    const open = outbox
      .listEffectStatuses()
      .filter((effect) => effect.status === 'pending' || effect.status === 'running');
    if (open.length === 0) break;
    await Bun.sleep(20);
  }
  outbox.close();
  await shinsa.stop();
}

function stopWhenSettled() {
  if (stopping || !isSettled()) return;
  stopping = true;
  queueMicrotask(() => {
    stopOnceSettled().then(
      () => {
        process.stdout.write('SETTLED\n');
        process.exit(0);
      },
      (error: unknown) => {
        process.stderr.write(`stop failed: ${String(error)}\n`);
        process.exit(1);
      }
    );
  });
}

function react() {
  answerGates();
  cancelOnCue();
  stopWhenSettled();
}

function isSettled() {
  const tasks = Object.values(shinsa.engine.state.tasks);
  if (tasks.length === 0) return false;
  const gates = listOpenGates(shinsa.engine.state);
  if (gates.some((gate) => gate.type === 'failure' && !isCrashPause(gate))) return true;
  return tasks.every((task) => isTaskSettled(task) && task.worktreePath === null);
}

resendAll();
shinsa.engine.subscribe(react);
react();
process.stdout.write('READY\n');
