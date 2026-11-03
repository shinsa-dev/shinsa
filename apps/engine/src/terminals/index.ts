import type { ShinsaState } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  NOTIFY_MS,
  type RemoteUrlSource,
  SCREEN_MS,
  type ServiceInput,
  type ServiceRun,
  type TerminalsHandle,
  type TerminalsListener,
  type TerminalStart,
  type TerminalsOptions,
} from './schema.ts';
import { makeTerminals } from './service.ts';
import type { TerminalViewer } from './session.ts';

export class Terminals {
  readonly #options: TerminalsOptions;
  readonly #handle: TerminalsHandle;

  constructor(options: TerminalsOptions) {
    this.#options = options;
    const { readForeground, pickPort, newId, spawn } = options;
    this.#handle = edgeRuntime.runSync(
      makeTerminals({
        dataDir: options.dataDir,
        home: options.home,
        version: options.version,
        readOnly: options.readOnly ?? false,
        env: options.env ?? process.env,
        ...(spawn ? { spawn } : {}),
        ...(readForeground ? { readForeground: (pid) => Effect.promise(() => readForeground(pid)) } : {}),
        ...(pickPort
          ? { pickPort: (preferred, taken) => Effect.sync(() => pickPort(preferred, taken)) }
          : {}),
        now: Effect.sync(options.now ?? Date.now),
        newId: Effect.sync(() => newId?.() ?? Bun.randomUUIDv7()),
        notifyMs: Duration.millis(options.notifyMs ?? NOTIFY_MS),
        screenMs: Duration.millis(options.screenMs ?? SCREEN_MS),
      })
    );
  }

  get home() {
    return this.#options.home;
  }

  get dataDir() {
    return this.#options.dataDir;
  }

  find(id: string) {
    return edgeRuntime.runSync(this.#handle.find(id));
  }

  select(id: string) {
    return edgeRuntime.runSync(this.#handle.select(id));
  }

  snapshot() {
    return edgeRuntime.runSync(this.#handle.snapshot);
  }

  applyRemoteUrls(source: RemoteUrlSource) {
    edgeRuntime.runSync(this.#handle.applyRemoteUrls(source));
  }

  subscribe(listener: TerminalsListener) {
    return edgeRuntime.runSync(this.#handle.subscribe(listener));
  }

  create(start: TerminalStart) {
    return edgeRuntime.runSync(this.#handle.create(start));
  }

  rename(id: string, name: string | null) {
    edgeRuntime.runSync(this.#handle.rename(id, name));
  }

  reorder(projectId: string, ids: string[]) {
    edgeRuntime.runSync(this.#handle.reorder(projectId, ids));
  }

  restart(id: string) {
    return edgeRuntime.runSync(this.#handle.restart(id));
  }

  run(id: string, command: string) {
    edgeRuntime.runSync(this.#handle.run(id, command));
  }

  readForeground(id: string) {
    return edgeRuntime.runPromise(this.#handle.readForeground(id));
  }

  close(id: string) {
    edgeRuntime.runSync(this.#handle.close(id));
  }

  findService(id: string) {
    return edgeRuntime.runSync(this.#handle.findService(id));
  }

  addService(projectId: string, input: ServiceInput) {
    return edgeRuntime.runSync(this.#handle.addService(projectId, input));
  }

  updateService(id: string, input: ServiceInput) {
    return edgeRuntime.runSync(this.#handle.updateService(id, input));
  }

  removeServices(ids: string[]) {
    edgeRuntime.runSync(this.#handle.removeServices(ids));
  }

  startService(id: string, run: ServiceRun) {
    return edgeRuntime.runSync(this.#handle.startService(id, run));
  }

  stopService(id: string, taskId: string | null) {
    return edgeRuntime.runPromise(this.#handle.stopService(id, taskId));
  }

  restartService(id: string, run: ServiceRun) {
    return edgeRuntime.runPromise(this.#handle.restartService(id, run));
  }

  readServiceOutput(id: string, taskId: string | null, lines: number) {
    return edgeRuntime.runPromise(this.#handle.readServiceOutput(id, taskId, lines));
  }

  closeTaskServices(taskId: string) {
    edgeRuntime.runSync(this.#handle.closeTaskServices(taskId));
  }

  listServiceProcesses = () => edgeRuntime.runSync(this.#handle.listServiceProcesses);

  listTerminalPids() {
    return edgeRuntime.runSync(this.#handle.listTerminalPids);
  }

  resumeServices(state: ShinsaState) {
    edgeRuntime.runSync(this.#handle.resumeServices(state));
  }

  attach(id: string, viewer: TerminalViewer) {
    edgeRuntime.runSync(this.#handle.attach(id, viewer));
  }

  stop() {
    return edgeRuntime.runPromise(this.#handle.stop);
  }
}

export { ServiceRefiner } from './refine.ts';
export type {
  RemoteUrlSource,
  ServiceInput,
  ServiceRun,
  TerminalSocketData,
  TerminalStart,
  TerminalsOptions,
} from './schema.ts';
export { createTerminalSockets, readTerminalSocketId } from './sockets.ts';
export type { TerminalViewer } from './session.ts';
