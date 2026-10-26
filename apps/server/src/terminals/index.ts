import {
  DomainError,
  SHINSA_APPEARANCE,
  TERMINAL_LIMITS,
  type TerminalAppearance,
  type TerminalInfo,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { resolveGhosttyAppearance, resolveGhosttyPlaces } from './ghostty.ts';
import {
  resolveLoginShell,
  resolveShellCommand,
  resolveTerminalEnv,
  spawnTerminalProcess,
  type TerminalSpawner,
} from './pty.ts';
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
  appearance?: () => TerminalAppearance;
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
  #notifyTimer: ReturnType<typeof setTimeout> | null = null;
  #appearance: TerminalAppearance | null = null;
  #stopped = false;

  constructor(options: TerminalsOptions) {
    this.#options = options;
    this.#store = new TerminalStore(options.dataDir);
    this.#now = options.now ?? Date.now;
    for (const saved of this.#store.readTerminals()) {
      const info: TerminalInfo =
        saved.status === 'running' ? { ...saved, status: 'stopped', endedAt: this.#now() } : saved;
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

  readAppearance() {
    const read =
      this.#options.appearance ?? (() => resolveGhosttyAppearance(resolveGhosttyPlaces(this.#env)));
    try {
      this.#appearance = read();
    } catch (error) {
      log.warn('[Terminals] Could not read the Ghostty config', { error: describeError(error) });
    }
    return this.#appearance;
  }

  get #env() {
    return this.#options.env ?? process.env;
  }

  snapshot(): TerminalsSnapshot {
    const appearance = this.#appearance ?? this.readAppearance();
    return {
      terminals: [...this.#sessions.values()].map((session) => session.info),
      appearance: appearance ?? { ...SHINSA_APPEARANCE },
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

  #start(session: TerminalSession) {
    const env = resolveTerminalEnv(this.#env, this.#options.version);
    session.start({
      command: resolveShellCommand(resolveLoginShell(this.#env)),
      env,
      spawn: this.#options.spawn ?? spawnTerminalProcess,
      now: this.#now(),
    });
  }

  create(start: TerminalStart) {
    this.#assertWritable();
    if (this.#sessions.size >= TERMINAL_LIMITS.terminals)
      throw new DomainError(
        'terminal_limit',
        `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most. Close one to open another.`
      );
    const id = this.#options.newId?.() ?? Bun.randomUUIDv7();
    const info: TerminalInfo = {
      id,
      ...start,
      name: null,
      title: null,
      status: 'running',
      exitCode: null,
      startedAt: this.#now(),
      endedAt: null,
    };
    const session = this.#createSession(info, null);
    this.#sessions.set(id, session);
    this.#start(session);
    this.#changed();
    return session.info;
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

  close(id: string) {
    this.#assertWritable();
    const session = this.find(id);
    this.#sessions.delete(id);
    clearTimeout(this.#screenTimers.get(id));
    this.#screenTimers.delete(id);
    session.hangUp();
    session.dispose();
    this.#store.removeScreen(id);
    this.#changed();
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
    await Promise.all(sessions.map((session) => session.stop()));
    for (const session of sessions) {
      this.#store.writeScreen(session.info.id, await session.serializeScreen());
      session.dispose();
    }
    this.#store.writeTerminals(sessions.map((session) => session.info));
    this.#listeners.clear();
  }
}

export {
  createTerminalRoutes,
  createTerminalSockets,
  readTerminalSocketId,
  type TerminalSocketData,
} from './routes.ts';
export type { TerminalViewer } from './session.ts';
