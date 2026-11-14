import {
  DomainError,
  isTaskSettled,
  SERVICE_LIMITS,
  type ServiceDefinition,
  type ShinsaState,
  TERMINAL_LIMITS,
  type TerminalForeground,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import {
  Clock,
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  pipe,
  Ref,
  Schedule,
  Struct,
} from 'effect';
import { EngineConfig } from '../config/service.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { listReclaimable, resolveLimitMessage, resolveServiceLimitMessage } from './limit.ts';
import {
  listenOnce,
  resolveLoginShell,
  resolveServiceCommand,
  resolveShellCommand,
  resolveTerminalEnv,
} from './pty.ts';
import { TerminalPty } from './pty/service.ts';
import { selectServiceRunIn } from './runs.ts';
import {
  type RemoteUrlSource,
  type ServiceInput,
  type ServiceRun,
  TerminalIds,
  type TerminalSession,
  type TerminalsInput,
  type TerminalsListener,
  type TerminalStart,
  TerminalTimings,
  type TerminalViewer,
} from './schema.ts';
import { createTerminalSession } from './session.ts';
import { TerminalFiles } from './store/service.ts';

export class Terminals extends Context.Service<
  Terminals,
  {
    readonly home: string;
    readonly dataDir: string;
    find(id: string): Effect.Effect<TerminalSession, DomainError>;
    select(id: string): Effect.Effect<TerminalSession | null>;
    readonly snapshot: Effect.Effect<TerminalsSnapshot>;
    applyRemoteUrls(source: RemoteUrlSource): Effect.Effect<void>;
    subscribe(listener: TerminalsListener): Effect.Effect<Effect.Effect<void>>;
    create(start: TerminalStart): Effect.Effect<TerminalInfo, DomainError>;
    rename(id: string, name: string | null): Effect.Effect<void, DomainError>;
    reorder(projectId: string, ids: string[]): Effect.Effect<void, DomainError>;
    restart(id: string): Effect.Effect<TerminalInfo, DomainError>;
    run(id: string, command: string): Effect.Effect<void, DomainError>;
    readForeground(id: string): Effect.Effect<TerminalForeground, DomainError>;
    close(id: string): Effect.Effect<void, DomainError>;
    findService(id: string): Effect.Effect<ServiceDefinition, DomainError>;
    addService(projectId: string, input: ServiceInput): Effect.Effect<ServiceDefinition, DomainError>;
    updateService(id: string, input: ServiceInput): Effect.Effect<ServiceDefinition, DomainError>;
    removeServices(ids: string[]): Effect.Effect<void, DomainError>;
    startService(id: string, run: ServiceRun): Effect.Effect<TerminalInfo, DomainError>;
    stopService(id: string, taskId: string | null): Effect.Effect<void, DomainError>;
    restartService(id: string, run: ServiceRun): Effect.Effect<TerminalInfo, DomainError>;
    readServiceOutput(id: string, taskId: string | null, lines: number): Effect.Effect<string[]>;
    closeTaskTerminals(taskId: string): Effect.Effect<void>;
    readonly listServiceProcesses: Effect.Effect<{ taskId: string; pid: number }[]>;
    readonly listTerminalPids: Effect.Effect<number[]>;
    resumeServices(state: ShinsaState): Effect.Effect<void>;
    attach(id: string, viewer: TerminalViewer): Effect.Effect<void, DomainError>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/terminals/Terminals') {
  static readonly layer = (input: TerminalsInput) =>
    Layer.effect(
      Terminals,
      Effect.gen(function* () {
        const files = yield* TerminalFiles;
        const pty = yield* TerminalPty;
        const config = yield* EngineConfig;
        const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
        const timings = yield* TerminalTimings;
        const newId = yield* TerminalIds;
        const clock = yield* Clock.Clock;
        const engine = yield* Effect.serviceOption(EngineCore);
        const context = yield* Effect.context<never>();
        const runSync = Effect.runSyncWith(context);
        const { dataDir } = config;
        const home = config.userHome;
        const readOnly = config.inspect;

        const services = yield* Ref.make<ReadonlyMap<string, ServiceDefinition>>(
          new Map((yield* files.readServices(dataDir)).map((service) => [service.id, service]))
        );
        const sessions = yield* Ref.make<ReadonlyMap<string, TerminalSession>>(new Map());
        const resumable = yield* Ref.make<ReadonlySet<string>>(new Set());
        const runEnvs = yield* Ref.make<ReadonlyMap<string, Record<string, string>>>(new Map());
        const listeners = yield* Ref.make<ReadonlySet<TerminalsListener>>(new Set());
        const remoteUrls = yield* Ref.make<RemoteUrlSource | null>(null);
        const stopped = yield* Ref.make(false);
        const notifyFiber = yield* Ref.make<Fiber.Fiber<void> | null>(null);
        const screenFibers = yield* Ref.make<ReadonlyMap<string, Fiber.Fiber<void>>>(new Map());
        const answerFibers = yield* Ref.make<ReadonlyMap<string, Fiber.Fiber<void>>>(new Map());
        const answerSchedule = Schedule.spaced(timings.answer).pipe(
          Schedule.upTo({ duration: timings.answerLimit })
        );

        const pickPort = (preferred: number | null, taken: ReadonlySet<number>) =>
          pty
            .pickPort(preferred, taken, listenOnce)
            .pipe(
              Effect.catchTag('PortUnavailable', (missing) =>
                Effect.fail(new DomainError({ code: 'service_port_unavailable', message: missing.message }))
              )
            );

        const assertWritable = readOnly
          ? Effect.fail(
              new DomainError({ code: 'inspect_read_only', message: 'Terminals are off in inspect mode.' })
            )
          : Effect.void;

        const interruptLater = (fiber: Fiber.Fiber<void> | null | undefined) =>
          fiber ? Effect.asVoid(Effect.forkDetach(Fiber.interrupt(fiber))) : Effect.void;

        const listSessions = Effect.map(Ref.get(sessions), (all) => [...all.values()]);

        const listInfos = Effect.map(listSessions, (all) => all.map((session) => session.info));

        const withRemoteUrl = Effect.fn('Terminals.withRemoteUrl')(function* (info: TerminalInfo) {
          const source = yield* Ref.get(remoteUrls);
          const service = info.serviceId ? (yield* Ref.get(services)).get(info.serviceId) : undefined;
          if (!(source && service)) return info;
          return { ...info, remoteUrl: yield* source.resolveRemoteUrl(info, service) };
        });

        const snapshot = Effect.gen(function* () {
          const terminals = yield* Effect.forEach(yield* listInfos, withRemoteUrl);
          const known = yield* Ref.get(services);
          const result: TerminalsSnapshot = { terminals, services: [...known.values()], home };
          return result;
        });

        const publish = Effect.gen(function* () {
          const published = yield* snapshot;
          yield* files.writeTerminals(dataDir, yield* listInfos);
          const listening = yield* Ref.get(listeners);
          yield* Effect.sync(() => {
            for (const listener of listening) listener(published);
          });
        });

        const scheduleNotify = Effect.gen(function* () {
          if ((yield* Ref.get(notifyFiber)) || (yield* Ref.get(stopped))) return;
          const fiber = yield* Effect.forkDetach(
            Effect.sleep(timings.notify).pipe(
              Effect.andThen(Ref.set(notifyFiber, null)),
              Effect.andThen(publish)
            )
          );
          yield* Ref.set(notifyFiber, fiber);
        });

        const changed = Effect.gen(function* () {
          yield* interruptLater(yield* Ref.getAndSet(notifyFiber, null));
          yield* publish;
        });

        const forgetScreenFiber = (id: string) =>
          Ref.modify(
            screenFibers,
            (fibers): [Fiber.Fiber<void> | undefined, ReadonlyMap<string, Fiber.Fiber<void>>] => {
              const next = new Map(fibers);
              next.delete(id);
              return [fibers.get(id), next];
            }
          );

        const saveScreen = Effect.fn('Terminals.saveScreen')(function* (session: TerminalSession) {
          const screen = yield* session.serializeScreen;
          if ((yield* Ref.get(sessions)).get(session.info.id) === session)
            yield* files.writeScreen(dataDir, session.info.id, screen);
        });

        const scheduleScreen = Effect.fn('Terminals.scheduleScreen')(function* (session: TerminalSession) {
          const { id } = session.info;
          const waiting = (yield* Ref.get(screenFibers)).has(id);
          if (waiting || (yield* Ref.get(stopped)) || (yield* Ref.get(sessions)).get(id) !== session) return;
          const fiber = yield* Effect.forkDetach(
            Effect.sleep(timings.screen).pipe(
              Effect.andThen(forgetScreenFiber(id)),
              Effect.andThen(saveScreen(session))
            )
          );
          yield* Ref.update(screenFibers, (fibers) => new Map(fibers).set(id, fiber));
        });

        const forgetAnswerFiber = (id: string) =>
          Ref.modify(
            answerFibers,
            (fibers): [Fiber.Fiber<void> | undefined, ReadonlyMap<string, Fiber.Fiber<void>>] => {
              const next = new Map(fibers);
              next.delete(id);
              return [fibers.get(id), next];
            }
          );

        const awaitAnswer = Effect.fn('Terminals.awaitAnswer')(function* (
          session: TerminalSession,
          port: number
        ) {
          yield* pty
            .isAnswering(port)
            .pipe(
              Effect.repeat({ schedule: answerSchedule, until: (answering) => answering || !session.running })
            );
          if (!session.running) return;
          session.info = { ...session.info, answering: true };
          yield* scheduleNotify;
        });

        const watchAnswer = Effect.fn('Terminals.watchAnswer')(function* (session: TerminalSession) {
          const { id, port } = session.info;
          const earlier = yield* forgetAnswerFiber(id);
          if (earlier) yield* Fiber.interrupt(earlier);
          const service = session.info.serviceId
            ? (yield* Ref.get(services)).get(session.info.serviceId)
            : undefined;
          session.info = pipe(session.info, Struct.omit(['answering']));
          if (!(service?.previewUrl && port !== null && session.running)) return;
          session.info = { ...session.info, answering: false };
          const fiber = yield* Effect.forkDetach(awaitAnswer(session, port));
          yield* Ref.update(answerFibers, (fibers) => new Map(fibers).set(id, fiber));
        });

        const createSession = (info: TerminalInfo, saved: string | null) =>
          createTerminalSession({
            info,
            saved,
            now: clock.currentTimeMillis,
            onChange: scheduleNotify,
            onScreen: scheduleScreen,
          });

        const writeSession = (session: TerminalSession) =>
          Ref.update(sessions, (all) => new Map(all).set(session.info.id, session));

        for (const saved of yield* files.readTerminals(dataDir)) {
          const known = saved.serviceId === null || (yield* Ref.get(services)).has(saved.serviceId);
          const endedAt = yield* clock.currentTimeMillis;
          const info: TerminalInfo = {
            ...(saved.status === 'running' ? { ...saved, status: 'stopped', endedAt } : saved),
            serviceId: known ? saved.serviceId : null,
          };
          if (saved.status === 'running' && info.serviceId)
            yield* Ref.update(resumable, (ids) => new Set(ids).add(info.id));
          yield* writeSession(yield* createSession(info, yield* files.readScreen(dataDir, info.id)));
        }

        const select = (id: string) => Effect.map(Ref.get(sessions), (all) => all.get(id) ?? null);

        const find = Effect.fn('Terminals.find')(function* (id: string) {
          const session = yield* select(id);
          if (!session)
            return yield* new DomainError({
              code: 'terminal_not_found',
              message: 'That terminal is closed.',
            });
          return session;
        });

        const findService = Effect.fn('Terminals.findService')(function* (id: string) {
          const service = (yield* Ref.get(services)).get(id);
          if (!service)
            return yield* new DomainError({
              code: 'service_not_found',
              message: 'That service is not there anymore.',
            });
          return service;
        });

        const resolvePort = Effect.fn('Terminals.resolvePort')(function* (
          session: TerminalSession,
          service: ServiceDefinition
        ) {
          const yours = session.info.taskId === null;
          if (yours && !service.previewUrl) return null;
          const own = Number(service.env[service.portVariable]);
          if (yours && Number.isInteger(own) && own > 0) return own;
          const taken = new Set(
            (yield* listSessions)
              .filter((each) => each !== session && each.running)
              .flatMap((each) => (each.info.port === null ? [] : [each.info.port]))
          );
          return yield* pickPort(session.info.port, taken);
        });

        const resolveServiceEnv = Effect.fn('Terminals.resolveServiceEnv')(function* (
          session: TerminalSession,
          service: ServiceDefinition,
          env: Record<string, string>
        ) {
          const port = yield* resolvePort(session, service);
          session.info = { ...session.info, port };
          const own = { ...env, ...(yield* Ref.get(runEnvs)).get(session.info.id), ...service.env };
          if (port === null) return own;
          return { ...own, [service.portVariable]: String(port) };
        });

        const start = Effect.fn('Terminals.start')(
          function* (session: TerminalSession) {
            const env = resolveTerminalEnv(input.env, input.version);
            const shell = resolveLoginShell(input.env);
            const service = session.info.serviceId
              ? (yield* Ref.get(services)).get(session.info.serviceId)
              : undefined;
            const command = service
              ? resolveServiceCommand(shell, service.command)
              : resolveShellCommand(shell);
            const runEnv = service ? yield* resolveServiceEnv(session, service, env) : env;
            yield* session.start({ command, env: runEnv, spawn: pty.spawn });
            yield* watchAnswer(session);
          },
          (effect, session) =>
            effect.pipe(
              Effect.catchTag('SpawnFailed', (failure) =>
                Effect.fail(new DomainError({ code: 'terminal_start_failed', message: failure.message }))
              ),
              Effect.tapError((failure) => session.fail(failure.message))
            )
        );

        const listTasks = Option.match(engine, {
          onNone: () => Effect.succeed({}),
          onSome: (core) => Effect.map(core.state, (state) => state.tasks),
        });

        const makeRoom = Effect.gen(function* () {
          const all = yield* listSessions;
          const over = all.length - TERMINAL_LIMITS.terminals + 1;
          if (over <= 0) return;
          const waiting = yield* Ref.get(resumable);
          const tasks = yield* listTasks;
          const ended = all.filter((session) => !session.running && !waiting.has(session.info.id));
          const reclaimable = listReclaimable(
            ended.map((session) => session.info),
            tasks
          );
          if (reclaimable.length < over) {
            const known = yield* Ref.get(services);
            return yield* new DomainError({
              code: 'terminal_limit',
              message: resolveLimitMessage(
                all
                  .filter((session) => session.running)
                  .map((session) => ({
                    taskId: session.info.taskId,
                    service: session.info.serviceId
                      ? (known.get(session.info.serviceId)?.name ?? null)
                      : null,
                  })),
                tasks
              ),
            });
          }
          const chosen = new Set(reclaimable.slice(0, over));
          for (const session of ended) if (chosen.has(session.info.id)) yield* closeSession(session);
        });

        const open = Effect.fn('Terminals.open')(function* (
          terminalStart: TerminalStart,
          service: ServiceDefinition | null,
          env: Record<string, string> = {}
        ) {
          yield* makeRoom;
          const info: TerminalInfo = {
            id: yield* newId,
            ...terminalStart,
            name: service?.name ?? null,
            title: null,
            serviceId: service?.id ?? null,
            port: null,
            status: 'running',
            exitCode: null,
            startedAt: yield* clock.currentTimeMillis,
            endedAt: null,
          };
          const session = yield* createSession(info, null);
          yield* writeSession(session);
          yield* Ref.update(runEnvs, (envs) => new Map(envs).set(info.id, env));
          yield* start(session);
          yield* changed;
          return session.info;
        });

        const create = Effect.fn('Terminals.create')(function* (terminalStart: TerminalStart) {
          yield* assertWritable;
          return yield* open(terminalStart, null);
        });

        const rename = Effect.fn('Terminals.rename')(function* (id: string, name: string | null) {
          yield* assertWritable;
          const session = yield* find(id);
          const trimmed = name?.trim().slice(0, TERMINAL_LIMITS.name) ?? '';
          session.info = { ...session.info, name: trimmed || null };
          yield* changed;
        });

        const reorder = Effect.fn('Terminals.reorder')(function* (projectId: string, ids: string[]) {
          yield* assertWritable;
          const all = yield* listSessions;
          const project = all.filter((session) => session.info.projectId === projectId);
          const ordered = [
            ...ids.flatMap((id) => project.filter((session) => session.info.id === id)),
            ...project.filter((session) => !ids.includes(session.info.id)),
          ];
          let next = 0;
          const merged = all.flatMap((session) => {
            const placed = session.info.projectId === projectId ? ordered[next++] : session;
            return placed ? [placed] : [];
          });
          yield* Ref.set(sessions, new Map(merged.map((session) => [session.info.id, session])));
          yield* changed;
        });

        const restart = Effect.fn('Terminals.restart')(function* (id: string) {
          yield* assertWritable;
          const session = yield* find(id);
          if (session.running) return session.info;
          yield* start(session);
          yield* changed;
          return session.info;
        });

        const run = Effect.fn('Terminals.run')(function* (id: string, command: string) {
          yield* assertWritable;
          const session = yield* find(id);
          if (!session.running)
            return yield* new DomainError({ code: 'terminal_ended', message: 'That terminal has ended.' });
          session.type(command);
        });

        const readTerminalForeground = Effect.fn('Terminals.readForeground')(function* (id: string) {
          const session = yield* find(id);
          const { pid } = session;
          if (pid === null) return { program: null };
          if (session.info.serviceId)
            return { program: (yield* Ref.get(services)).get(session.info.serviceId)?.name ?? null };
          return { program: yield* pty.readForeground(pid) };
        });

        const closeSession = Effect.fn('Terminals.closeSession')(function* (session: TerminalSession) {
          const { id } = session.info;
          yield* Ref.update(sessions, (all) => {
            const next = new Map(all);
            next.delete(id);
            return next;
          });
          yield* Ref.update(runEnvs, (envs) => {
            const next = new Map(envs);
            next.delete(id);
            return next;
          });
          yield* interruptLater(yield* forgetScreenFiber(id));
          yield* interruptLater(yield* forgetAnswerFiber(id));
          session.hangUp();
          session.dispose();
          yield* files.removeScreen(dataDir, id);
        });

        const close = Effect.fn('Terminals.close')(function* (id: string) {
          yield* assertWritable;
          yield* closeSession(yield* find(id));
          yield* changed;
        });

        const selectServiceSession = (id: string, taskId: string | null) =>
          Effect.map(
            listSessions,
            (all) =>
              all.find((session) => session.info.serviceId === id && session.info.taskId === taskId) ?? null
          );

        const listServiceSessions = (id: string) =>
          Effect.map(listSessions, (all) => all.filter((session) => session.info.serviceId === id));

        const saveServices = Effect.flatMap(Ref.get(services), (known) =>
          files.writeServices(dataDir, [...known.values()])
        );

        const addService = Effect.fn('Terminals.addService')(function* (
          projectId: string,
          serviceInput: ServiceInput
        ) {
          yield* assertWritable;
          const names = [...(yield* Ref.get(services)).values()].flatMap((each) =>
            each.projectId === projectId ? [each.name] : []
          );
          if (names.length >= SERVICE_LIMITS.services)
            return yield* new DomainError({
              code: 'service_limit',
              message: resolveServiceLimitMessage(names, 1),
            });
          const service: ServiceDefinition = { id: yield* newId, projectId, ...serviceInput };
          yield* Ref.update(services, (known) => new Map(known).set(service.id, service));
          yield* saveServices;
          yield* changed;
          return service;
        });

        const updateService = Effect.fn('Terminals.updateService')(function* (
          id: string,
          serviceInput: ServiceInput
        ) {
          yield* assertWritable;
          const service = { ...(yield* findService(id)), ...serviceInput };
          yield* Ref.update(services, (known) => new Map(known).set(id, service));
          for (const session of yield* listServiceSessions(id))
            session.info = { ...session.info, name: service.name };
          yield* saveServices;
          yield* changed;
          return service;
        });

        const removeServices = Effect.fn('Terminals.removeServices')(function* (ids: string[]) {
          yield* assertWritable;
          for (const id of ids) yield* findService(id);
          for (const id of ids) {
            for (const session of yield* listServiceSessions(id)) yield* closeSession(session);
            yield* Ref.update(services, (known) => {
              const next = new Map(known);
              next.delete(id);
              return next;
            });
          }
          yield* saveServices;
          yield* changed;
        });

        const startService = Effect.fn('Terminals.startService')(function* (
          id: string,
          serviceRun: ServiceRun
        ) {
          yield* assertWritable;
          const service = yield* findService(id);
          const { env = {}, ...rest } = serviceRun;
          const session = yield* selectServiceSession(id, serviceRun.taskId);
          if (!session) return yield* open({ projectId: service.projectId, ...rest }, service, env);
          if (session.running) return session.info;
          session.info = { ...session.info, cwd: serviceRun.cwd, place: serviceRun.place };
          yield* Ref.update(runEnvs, (envs) => new Map(envs).set(session.info.id, env));
          yield* start(session);
          yield* changed;
          return session.info;
        });

        const stopService = Effect.fn('Terminals.stopService')(function* (id: string, taskId: string | null) {
          yield* assertWritable;
          yield* findService(id);
          const session = yield* selectServiceSession(id, taskId);
          if (session) yield* session.stop;
          yield* changed;
        });

        const restartService = Effect.fn('Terminals.restartService')(function* (
          id: string,
          serviceRun: ServiceRun
        ) {
          yield* stopService(id, serviceRun.taskId);
          return yield* startService(id, serviceRun);
        });

        const readServiceOutput = Effect.fn('Terminals.readServiceOutput')(function* (
          id: string,
          taskId: string | null,
          lines: number
        ) {
          const session = yield* selectServiceSession(id, taskId);
          if (!session) return [];
          return yield* session.readOutput(lines);
        });

        const closeTaskTerminals = Effect.fn('Terminals.closeTaskTerminals')(function* (taskId: string) {
          const owned = (yield* listSessions).filter(
            (session) =>
              session.info.taskId === taskId && (session.info.serviceId !== null || !session.running)
          );
          if (owned.length === 0) return;
          for (const session of owned) yield* closeSession(session);
          yield* changed;
        });

        const listServiceProcesses = Effect.map(listSessions, (all) =>
          all.flatMap((session) => {
            const { serviceId, taskId } = session.info;
            return serviceId && taskId && session.pid !== null ? [{ taskId, pid: session.pid }] : [];
          })
        );

        const listTerminalPids = Effect.map(listSessions, (all) =>
          all.flatMap((session) => (session.info.serviceId || session.pid === null ? [] : [session.pid]))
        );

        const pruneSettled = Effect.fn('Terminals.pruneSettled')(function* (state: ShinsaState) {
          const settled = (yield* listSessions).filter((session) => {
            const { taskId } = session.info;
            if (taskId === null || session.running) return false;
            const task = state.tasks[taskId];
            return !task || isTaskSettled(task);
          });
          if (settled.length === 0) return;
          for (const session of settled) {
            yield* Ref.update(resumable, (ids) => {
              const next = new Set(ids);
              next.delete(session.info.id);
              return next;
            });
            yield* closeSession(session);
          }
          yield* changed;
        });

        const resumeService = Effect.fn('Terminals.resumeService')(function* (
          state: ShinsaState,
          terminalId: string
        ) {
          const info = (yield* select(terminalId))?.info;
          const service = (yield* Ref.get(services)).get(info?.serviceId ?? '');
          if (!(info && service)) return;
          yield* withFiles(selectServiceRunIn(state, service, info.taskId, { home, dataDir })).pipe(
            Effect.flatMap((serviceRun) =>
              Option.isSome(serviceRun) ? startService(service.id, serviceRun.value) : Effect.void
            ),
            Effect.catch((failure) =>
              Effect.logWarning('[Terminals] Could not start a service again after the restart').pipe(
                Effect.annotateLogs({
                  service: service.name,
                  taskId: info.taskId,
                  error: failure.message,
                })
              )
            )
          );
        });

        const resumeServices = Effect.fn('Terminals.resumeServices')(function* (state: ShinsaState) {
          if (readOnly) return;
          yield* pruneSettled(state);
          for (const terminalId of yield* Ref.get(resumable)) yield* resumeService(state, terminalId);
          yield* Ref.set(resumable, new Set());
        });

        const applyRemoteUrls = Effect.fn('Terminals.applyRemoteUrls')(function* (source: RemoteUrlSource) {
          yield* Ref.set(remoteUrls, source);
          source.subscribe(() => runSync(scheduleNotify));
          yield* scheduleNotify;
        });

        const subscribe = Effect.fn('Terminals.subscribe')(function* (listener: TerminalsListener) {
          yield* Ref.update(listeners, (all) => new Set(all).add(listener));
          return Ref.update(listeners, (all) => {
            const next = new Set(all);
            next.delete(listener);
            return next;
          });
        });

        const attach = Effect.fn('Terminals.attach')(function* (id: string, viewer: TerminalViewer) {
          (yield* find(id)).attach(viewer);
        });

        const stop = Effect.gen(function* () {
          if (yield* Ref.getAndSet(stopped, true)) return;
          const notify = yield* Ref.getAndSet(notifyFiber, null);
          const screens = yield* Ref.getAndSet(screenFibers, new Map());
          const answers = yield* Ref.getAndSet(answerFibers, new Map());
          yield* Fiber.interruptAll([...(notify ? [notify] : []), ...screens.values(), ...answers.values()]);
          const all = yield* listSessions;
          const running = new Set(
            all
              .filter((session) => session.running && session.info.serviceId)
              .map((session) => session.info.id)
          );
          yield* Effect.forEach(all, (session) => session.stop, { concurrency: 'unbounded', discard: true });
          for (const session of all) {
            yield* files.writeScreen(dataDir, session.info.id, yield* session.serializeScreen);
            session.dispose();
          }
          yield* files.writeTerminals(
            dataDir,
            all.map((session) =>
              running.has(session.info.id)
                ? { ...session.info, status: 'running', endedAt: null }
                : session.info
            )
          );
          yield* Ref.set(listeners, new Set());
        });

        yield* Effect.addFinalizer(() => stop);

        return Terminals.of({
          home,
          dataDir,
          find,
          select,
          snapshot,
          applyRemoteUrls,
          subscribe,
          create,
          rename,
          reorder,
          restart,
          run,
          readForeground: readTerminalForeground,
          close,
          findService,
          addService,
          updateService,
          removeServices,
          startService,
          stopService,
          restartService,
          readServiceOutput,
          closeTaskTerminals,
          listServiceProcesses,
          listTerminalPids,
          resumeServices,
          attach,
          stop,
        });
      })
    );
}
