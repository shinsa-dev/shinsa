import {
  resolveTaskProject,
  resolveTaskTerminalPlace,
  type ShinsaState,
  type Task,
  type TerminalPlace,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Effect } from 'effect';
import { useSyncExternalStore } from 'react';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { connection } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import type { ServiceInput } from '@/lib/terminal/services.ts';
import { resolveTerminalPath } from '@/lib/terminal/tabs.ts';
import { selectTerminalView } from '@/lib/terminal/view.ts';
import { navigate } from '@/router.ts';
import {
  ForegroundAnswer,
  NO_TERMINAL_PLACE_MESSAGE,
  NoTerminalPlace,
  ServiceAddedAnswer,
  ServicesAddedAnswer,
  ServiceStoppedAnswer,
  TerminalOpenedAnswer,
} from './schema.ts';

type Engine = EngineClient['Service'];

const decodeOpened = decodeAnswer(TerminalOpenedAnswer);

const decodeServiceAdded = decodeAnswer(ServiceAddedAnswer);

const decodeServicesAdded = decodeAnswer(ServicesAddedAnswer);

const decodeStopped = decodeAnswer(ServiceStoppedAnswer);

const decodeForeground = decodeAnswer(ForegroundAnswer);

export function useTerminals() {
  return useSyncExternalStore(connection.subscribeTerminals, connection.selectTerminals);
}

export function resolveTerminalTransport(terminalId: string) {
  return connection.resolveTerminalTransport?.(terminalId) ?? undefined;
}

export function canOpenTerminals(projectId: string) {
  return connection.canOpenTerminals?.(projectId) ?? true;
}

const replaceTerminals = Effect.fn('Terminals.replace')(function* (
  call: (engine: Engine) => Effect.Effect<TerminalsSnapshot, Error>
) {
  const answer = yield* call(yield* EngineClient);
  connection.replaceTerminals(answer);
  return answer;
});

function updateTerminals(call: (engine: Engine) => Effect.Effect<TerminalsSnapshot, Error>) {
  return runApp(replaceTerminals(call));
}

const createTerminal = Effect.fn('Terminals.create')(function* (
  projectId: string,
  place: TerminalPlace,
  command?: string
) {
  const engine = yield* EngineClient;
  const answer = yield* engine.terminals.create({
    payload: { projectId, path: place.path, ...(command ? { command } : {}) },
  });
  const { terminal, ...snapshot } = yield* decodeOpened(answer);
  connection.replaceTerminals(snapshot);
  return terminal;
});

export function requestTerminalCreate(projectId: string, place: TerminalPlace, command?: string) {
  return runApp(createTerminal(projectId, place, command));
}

export function openTerminal(projectKey: string, projectId: string, place: TerminalPlace, command?: string) {
  return requestWithToast(() =>
    runApp(
      Effect.tap(createTerminal(projectId, place, command), (terminal) =>
        Effect.sync(() => navigate(resolveTerminalPath(projectKey, terminal.id)))
      )
    )
  );
}

export function selectTaskTerminal(state: ShinsaState | null, task: Task) {
  const projectId = state ? resolveTaskProject(state, task) : null;
  const project = projectId ? state?.projects[projectId] : undefined;
  const place = state ? resolveTaskTerminalPlace(state, task) : null;
  return project && place ? { project, place } : null;
}

const openForTask = Effect.fn('Terminals.openForTask')(function* (task: Task, command?: string) {
  const terminal = selectTaskTerminal(connection.snapshot().state, task);
  if (!terminal) return yield* new NoTerminalPlace({ message: NO_TERMINAL_PLACE_MESSAGE });
  const { project, place } = terminal;
  const created = yield* createTerminal(project.id, place, command);
  navigate(resolveTerminalPath(project.key, created.id));
});

export function openTaskTerminal(task: Task, command?: string) {
  return requestWithToast(() => runApp(openForTask(task, command)));
}

export function renameTerminal(id: string, name: string | null) {
  return requestWithToast(() =>
    updateTerminals((engine) => engine.terminals.rename({ params: { terminalId: id }, payload: { name } }))
  );
}

export function restartTerminal(id: string) {
  return requestWithToast(() =>
    updateTerminals((engine) => engine.terminals.restart({ params: { terminalId: id }, payload: {} }))
  );
}

export function closeTerminal(id: string) {
  return requestWithToast(() =>
    updateTerminals((engine) => engine.terminals.close({ params: { terminalId: id }, payload: {} }))
  );
}

export function reorderTerminals(projectId: string, ids: string[]) {
  return requestWithToast(() =>
    updateTerminals((engine) => engine.terminals.reorder({ payload: { projectId, ids } }))
  );
}

const readForeground = Effect.fn('Terminals.readForeground')(function* (id: string) {
  const engine = yield* EngineClient;
  const answer = yield* engine.terminals.foreground({ params: { terminalId: id } });
  return yield* decodeForeground(answer);
});

export function requestTerminalForeground(id: string) {
  return runApp(readForeground(id));
}

const listSuggestions = Effect.fn('Services.listSuggestions')(function* (projectId: string, refine: boolean) {
  const engine = yield* EngineClient;
  return yield* engine.services.suggestions({ query: { projectId, ...(refine ? { refine: '1' } : {}) } });
});

export function requestServiceSuggestions(projectId: string) {
  return runApp(Effect.map(listSuggestions(projectId, false), (answer) => [...answer.suggestions]));
}

export function requestRefinedServiceSuggestions(projectId: string) {
  return runApp(
    Effect.map(listSuggestions(projectId, true), (answer) =>
      answer.refined ? [...answer.suggestions] : null
    )
  );
}

function serializeServiceInput(input: ServiceInput) {
  return {
    name: input.name,
    path: input.cwd,
    command: input.command,
    env: input.env,
    previewUrl: input.previewUrl,
    portVariable: input.portVariable,
  };
}

const addService = Effect.fn('Services.add')(function* (projectId: string, input: ServiceInput) {
  const engine = yield* EngineClient;
  const answer = yield* engine.services.add({ payload: { projectId, ...serializeServiceInput(input) } });
  const { service, ...snapshot } = yield* decodeServiceAdded(answer);
  connection.replaceTerminals(snapshot);
  return service;
});

export function requestServiceAdd(projectId: string, input: ServiceInput) {
  return runApp(addService(projectId, input));
}

const addServices = Effect.fn('Services.addBatch')(function* (projectId: string, inputs: ServiceInput[]) {
  const engine = yield* EngineClient;
  const answer = yield* engine.services.addBatch({
    payload: { projectId, services: inputs.map(serializeServiceInput) },
  });
  const { added, ...snapshot } = yield* decodeServicesAdded(answer);
  connection.replaceTerminals(snapshot);
  return added;
});

export function requestServicesAdd(projectId: string, inputs: ServiceInput[]) {
  return runApp(addServices(projectId, inputs));
}

export function requestServiceUpdate(id: string, input: ServiceInput) {
  return updateTerminals((engine) =>
    engine.services.update({ params: { serviceId: id }, payload: serializeServiceInput(input) })
  );
}

export function requestServicesRemove(ids: string[]) {
  return updateTerminals((engine) => engine.services.remove({ payload: { ids } }));
}

function resolveRunBody(taskId: string | null) {
  return taskId ? { taskId } : {};
}

const runService = Effect.fn('Services.run')(function* (
  id: string,
  action: 'start' | 'restart',
  taskId: string | null
) {
  const engine = yield* EngineClient;
  const answer = yield* engine.services[action]({
    params: { serviceId: id },
    payload: resolveRunBody(taskId),
  });
  const { terminal, ...snapshot } = yield* decodeOpened(answer);
  connection.replaceTerminals(snapshot);
  return terminal;
});

const stopRun = Effect.fn('Services.stop')(function* (id: string, taskId: string | null) {
  const engine = yield* EngineClient;
  const answer = yield* engine.services.stop({ params: { serviceId: id }, payload: resolveRunBody(taskId) });
  const snapshot = yield* decodeStopped(answer);
  connection.replaceTerminals(snapshot);
  return snapshot;
});

export function startService(id: string, taskId: string | null = null) {
  return requestWithToast(() => runApp(runService(id, 'start', taskId)));
}

export function restartService(id: string, taskId: string | null = null) {
  return requestWithToast(() => runApp(runService(id, 'restart', taskId)));
}

export function stopService(id: string, taskId: string | null = null) {
  return requestWithToast(() => runApp(stopRun(id, taskId)));
}

export function startAllServices(projectId: string) {
  return requestWithToast(() =>
    updateTerminals((engine) => engine.services.startAll({ payload: { projectId } }))
  );
}

export function openServiceTerminal(projectKey: string, terminalId: string) {
  navigate(resolveTerminalPath(projectKey, terminalId));
  selectTerminalView(terminalId)?.focus();
}
