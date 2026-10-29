import {
  DomainError,
  SERVICE_LIMITS,
  type ServiceDefinition,
  type ShinsaState,
  TERMINAL_LIMITS,
  type TerminalForeground,
  type TerminalInfo,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import {
  type ForegroundReader,
  type PortPicker,
  pickFreePort,
  readForegroundProgram,
  resolveLoginShell,
  resolveServiceCommand,
  resolveShellCommand,
  resolveTerminalEnv,
  spawnTerminalProcess,
  type TerminalSpawner,
} from './pty.ts';
import { resolveServiceRunIn } from './routes.ts';
import { TerminalSession, type TerminalViewer } from './session.ts';
import { TerminalStore } from './store.ts';

type Env = Record<string, string | undefined>;

export interface TerminalsOptions {
  dataDir: string;
  home: string;
  version: string;
  readOnly?: boolean;
  env?: Env;
  spawn?: TerminalSpawner;
  readForeground?: ForegroundReader;
  pickPort?: PortPicker;
  now?: () => number;
  newId?: () => string;
  notifyMs?: number;
  screenMs?: number;
}

export interface TerminalStart {
  projectId: string;
  cwd: string;
  place: TerminalPlaceKind;
  taskId: string | null;
}

export interface ServiceRun {
  cwd: string;
  place: TerminalPlaceKind;
  taskId: string | null;
}

export interface ServiceInput {
  name: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  previewUrl: string | null;
  portVariable: string;
}

type Listener = (snapshot: TerminalsSnapshot) => void;

const NOTIFY_MS = 50;

const SCREEN_MS = 2_000;

function normaliseName(name: string | null) {
  const trimmed = name?.trim().slice(0, TERMINAL_LIMITS.name) ?? '';
  return trimmed || null;
}

export class Terminals {
  readonly #options: TerminalsOptions;
  readonly #store: TerminalStore;
  readonly #sessions = new Map<string, TerminalSession>();
  readonly #listeners = new Set<Listener>();
  readonly #screenTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #now: () => number;
  readonly #services = new Map<string, ServiceDefinition>();
  readonly #resumable = new Set<string>();
  #notifyTimer: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;

  constructor(options: TerminalsOptions) {
    this.#options = options;
    this.#store = new TerminalStore(options.dataDir);
    this.#now = options.now ?? Date.now;
    for (const service of this.#store.readServices()) this.#services.set(service.id, service);
    for (const saved of this.#store.readTerminals()) {
      const known = saved.serviceId === null || this.#services.has(saved.serviceId);
      const info: TerminalInfo = {
        ...(saved.status === 'running' ? { ...saved, status: 'stopped', endedAt: this.#now() } : saved),
        serviceId: known ? saved.serviceId : null,
      };
      if (saved.status === 'running' && info.serviceId) this.#resumable.add(info.id);
      this.#sessions.set(info.id, this.#createSession(info, this.#store.readScreen(info.id)));
    }
  }

  #createSession(info: TerminalInfo, saved: string | null) {
    return new TerminalSession({
      info,
      saved,
      now: this.#now,
      onChange: () => this.#scheduleNotify(),
      onScreen: (session) => this.#scheduleScreen(session),
    });
  }

  #assertWritable() {
    if (this.#options.readOnly)
      throw new DomainError('inspect_read_only', 'Terminals are off while Shinsa only shows saved state.');
  }

  get home() {
    return this.#options.home;
  }

  find(id: string) {
    const session = this.#sessions.get(id);
    if (!session) throw new DomainError('terminal_not_found', 'That terminal is closed.');
    return session;
  }

  select(id: string) {
    return this.#sessions.get(id) ?? null;
  }

  get #env() {
    return this.#options.env ?? process.env;
  }

  snapshot(): TerminalsSnapshot {
    return {
      terminals: [...this.#sessions.values()].map((session) => session.info),
      services: [...this.#services.values()],
      home: this.#options.home,
    };
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #scheduleNotify() {
    if (this.#notifyTimer || this.#stopped) return;
    this.#notifyTimer = setTimeout(() => {
      this.#notifyTimer = null;
      this.#publish();
    }, this.#options.notifyMs ?? NOTIFY_MS);
  }

  #publish() {
    const snapshot = this.snapshot();
    this.#store.writeTerminals(snapshot.terminals);
    for (const listener of this.#listeners) listener(snapshot);
  }

  #changed() {
    if (this.#notifyTimer) clearTimeout(this.#notifyTimer);
    this.#notifyTimer = null;
    this.#publish();
  }

  #scheduleScreen(session: TerminalSession) {
    const id = session.info.id;
    if (this.#screenTimers.has(id) || this.#stopped || this.#sessions.get(id) !== session) return;
    this.#screenTimers.set(
      id,
      setTimeout(() => {
        this.#screenTimers.delete(id);
        void this.#saveScreen(session);
      }, this.#options.screenMs ?? SCREEN_MS)
    );
  }

  async #saveScreen(session: TerminalSession) {
    const screen = await session.serializeScreen();
    if (this.#sessions.get(session.info.id) === session) this.#store.writeScreen(session.info.id, screen);
  }

  #takenPorts(session: TerminalSession) {
    return new Set(
      [...this.#sessions.values()]
        .filter((each) => each !== session && each.running)
        .flatMap((each) => (each.info.port === null ? [] : [each.info.port]))
    );
  }

  #resolvePort(session: TerminalSession, service: ServiceDefinition) {
    const yours = session.info.taskId === null;
    if (yours && !service.previewUrl) return null;
    const own = Number(service.env[service.portVariable]);
    if (yours && Number.isInteger(own) && own > 0) return own;
    return (this.#options.pickPort ?? pickFreePort)(session.info.port, this.#takenPorts(session));
  }

  #resolveServiceEnv(session: TerminalSession, service: ServiceDefinition, env: Record<string, string>) {
    const port = this.#resolvePort(session, service);
    session.info = { ...session.info, port };
    if (port === null) return { ...env, ...service.env };
    return { ...env, ...service.env, [service.portVariable]: String(port) };
  }

  #start(session: TerminalSession) {
    const env = resolveTerminalEnv(this.#env, this.#options.version);
    const shell = resolveLoginShell(this.#env);
    const service = session.info.serviceId ? this.#services.get(session.info.serviceId) : undefined;
    session.start({
      command: service ? resolveServiceCommand(shell, service.command) : resolveShellCommand(shell),
      env: service ? this.#resolveServiceEnv(session, service, env) : env,
      spawn: this.#options.spawn ?? spawnTerminalProcess,
      now: this.#now(),
    });
  }

  #newId() {
    return this.#options.newId?.() ?? Bun.randomUUIDv7();
  }

  #open(start: TerminalStart, service: ServiceDefinition | null) {
    if (this.#sessions.size >= TERMINAL_LIMITS.terminals)
      throw new DomainError(
        'terminal_limit',
        `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most. Close one to open another.`
      );
    const info: TerminalInfo = {
      id: this.#newId(),
      ...start,
      name: service?.name ?? null,
      title: null,
      serviceId: service?.id ?? null,
      port: null,
      status: 'running',
      exitCode: null,
      startedAt: this.#now(),
      endedAt: null,
    };
    const session = this.#createSession(info, null);
    this.#sessions.set(info.id, session);
    this.#start(session);
    this.#changed();
    return session.info;
  }

  create(start: TerminalStart) {
    this.#assertWritable();
    return this.#open(start, null);
  }

  rename(id: string, name: string | null) {
    this.#assertWritable();
    const session = this.find(id);
    session.info = { ...session.info, name: normaliseName(name) };
    this.#changed();
  }

  reorder(projectId: string, ids: string[]) {
    this.#assertWritable();
    const all = [...this.#sessions.values()];
    const project = all.filter((session) => session.info.projectId === projectId);
    const ordered = [
      ...ids.flatMap((id) => project.filter((session) => session.info.id === id)),
      ...project.filter((session) => !ids.includes(session.info.id)),
    ];
    let next = 0;
    const merged = all.map((session) => (session.info.projectId === projectId ? ordered[next++] : session));
    this.#sessions.clear();
    for (const session of merged) if (session) this.#sessions.set(session.info.id, session);
    this.#changed();
  }

  restart(id: string) {
    this.#assertWritable();
    const session = this.find(id);
    if (session.running) return session.info;
    this.#start(session);
    this.#changed();
    return session.info;
  }

  run(id: string, command: string) {
    this.#assertWritable();
    const session = this.find(id);
    if (!session.running)
      throw new DomainError('terminal_ended', 'That terminal has ended. Start it again first.');
    session.type(command);
  }

  async readForeground(id: string): Promise<TerminalForeground> {
    const session = this.find(id);
    const { pid } = session;
    if (pid === null) return { program: null };
    if (session.info.serviceId) return { program: this.#services.get(session.info.serviceId)?.name ?? null };
    return { program: await (this.#options.readForeground ?? readForegroundProgram)(pid) };
  }

  close(id: string) {
    this.#assertWritable();
    this.#closeSession(this.find(id));
    this.#changed();
  }

  #closeSession(session: TerminalSession) {
    const { id } = session.info;
    this.#sessions.delete(id);
    clearTimeout(this.#screenTimers.get(id));
    this.#screenTimers.delete(id);
    session.hangUp();
    session.dispose();
    this.#store.removeScreen(id);
  }

  findService(id: string) {
    const service = this.#services.get(id);
    if (!service) throw new DomainError('service_not_found', 'That service is not there anymore.');
    return service;
  }

  #serviceSession(id: string, taskId: string | null) {
    return (
      [...this.#sessions.values()].find(
        (session) => session.info.serviceId === id && session.info.taskId === taskId
      ) ?? null
    );
  }

  #serviceSessions(id: string) {
    return [...this.#sessions.values()].filter((session) => session.info.serviceId === id);
  }

  #saveServices() {
    this.#store.writeServices([...this.#services.values()]);
  }

  addService(projectId: string, input: ServiceInput) {
    this.#assertWritable();
    if (this.#services.size >= SERVICE_LIMITS.services)
      throw new DomainError(
        'service_limit',
        `Shinsa keeps ${SERVICE_LIMITS.services} services at most. Remove one to add another.`
      );
    const service: ServiceDefinition = { id: this.#newId(), projectId, ...input };
    this.#services.set(service.id, service);
    this.#saveServices();
    this.#changed();
    return service;
  }

  updateService(id: string, input: ServiceInput) {
    this.#assertWritable();
    const service = { ...this.findService(id), ...input };
    this.#services.set(id, service);
    for (const session of this.#serviceSessions(id)) session.info = { ...session.info, name: service.name };
    this.#saveServices();
    this.#changed();
    return service;
  }

  removeServices(ids: string[]) {
    this.#assertWritable();
    for (const id of ids) this.findService(id);
    for (const id of ids) {
      for (const session of this.#serviceSessions(id)) this.#closeSession(session);
      this.#services.delete(id);
    }
    this.#saveServices();
    this.#changed();
  }

  startService(id: string, run: ServiceRun) {
    this.#assertWritable();
    const service = this.findService(id);
    const session = this.#serviceSession(id, run.taskId);
    if (!session) return this.#open({ projectId: service.projectId, ...run }, service);
    if (session.running) return session.info;
    session.info = { ...session.info, cwd: run.cwd, place: run.place };
    this.#start(session);
    this.#changed();
    return session.info;
  }

  async stopService(id: string, taskId: string | null) {
    this.#assertWritable();
    this.findService(id);
    await this.#serviceSession(id, taskId)?.stop();
    this.#changed();
  }

  async restartService(id: string, run: ServiceRun) {
    await this.stopService(id, run.taskId);
    return this.startService(id, run);
  }

  async readServiceOutput(id: string, taskId: string | null, lines: number) {
    return (await this.#serviceSession(id, taskId)?.readOutput(lines)) ?? [];
  }

  closeTaskServices(taskId: string) {
    const sessions = [...this.#sessions.values()].filter(
      (session) => session.info.serviceId && session.info.taskId === taskId
    );
    if (sessions.length === 0) return;
    for (const session of sessions) this.#closeSession(session);
    this.#changed();
  }

  resumeServices(state: ShinsaState) {
    if (this.#options.readOnly) return;
    for (const terminalId of this.#resumable) {
      const info = this.#sessions.get(terminalId)?.info;
      const service = this.#services.get(info?.serviceId ?? '');
      const run = info && service ? resolveServiceRunIn(state, service, info.taskId, this.home) : null;
      if (service && run) this.startService(service.id, run);
    }
    this.#resumable.clear();
  }

  attach(id: string, viewer: TerminalViewer) {
    this.find(id).attach(viewer);
  }

  async stop() {
    this.#stopped = true;
    if (this.#notifyTimer) clearTimeout(this.#notifyTimer);
    for (const timer of this.#screenTimers.values()) clearTimeout(timer);
    this.#screenTimers.clear();
    const sessions = [...this.#sessions.values()];
    const resumable = new Set(
      sessions
        .filter((session) => session.running && session.info.serviceId)
        .map((session) => session.info.id)
    );
    await Promise.all(sessions.map((session) => session.stop()));
    for (const session of sessions) {
      this.#store.writeScreen(session.info.id, await session.serializeScreen());
      session.dispose();
    }
    this.#store.writeTerminals(
      sessions.map((session) =>
        resumable.has(session.info.id) ? { ...session.info, status: 'running', endedAt: null } : session.info
      )
    );
    this.#listeners.clear();
  }
}

export { ServiceRefiner } from './refine.ts';
export {
  createTerminalRoutes,
  createTerminalSockets,
  readTerminalSocketId,
  type TerminalSocketData,
} from './routes.ts';
export type { TerminalViewer } from './session.ts';
