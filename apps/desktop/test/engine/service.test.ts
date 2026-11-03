import { describe, expect, it } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { serializeEngineAgent } from '../../src/engine/launchd.ts';
import { EngineSupervisor } from '../../src/engine/service.ts';
import { answerJson, createWorld, type DesktopWorld, RESOURCES, runDesktop } from '../support/desktop.ts';

const AGENT = '/Users/me/Library/LaunchAgents/studio.overclock.shinsa.engine.plist';

const OLD_SERVICE = '/Users/me/Library/LaunchAgents/studio.overclock.shinsa.plist';

const DATA = '/Users/me/.config/shinsa/data';

const PROGRAM = `${RESOURCES}/engine/bin/shinsa`;

const TARGET = 'gui/501/studio.overclock.shinsa.engine';

const HEALTHY = answerJson({ ok: true, version: '1.2.0' });

function answerAfter(misses: number) {
  let asked = 0;
  return (path: string) => {
    if (path !== '/api/health') return 'refuse' as const;
    asked += 1;
    return asked > misses ? HEALTHY : ('refuse' as const);
  };
}

function ensure(world: DesktopWorld) {
  const started: string[] = [];
  return runDesktop(
    world,
    EngineSupervisor.use((engine) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          engine.ensure(
            Effect.sync(() => {
              started.push('starting');
            })
          )
        );
        yield* TestClock.adjust('40 seconds');
        return yield* Fiber.join(fiber);
      })
    )
  ).then((outcome) => ({ outcome, started }));
}

function listCommands(world: DesktopWorld) {
  return world.launchctl.filter((args) => args[0] !== 'print').map((args) => args.join(' '));
}

describe('the engine supervisor', () => {
  it('uses an engine that already answers, without touching launchd', async () => {
    const world = createWorld({ answer: () => HEALTHY });
    const { outcome, started } = await ensure(world);
    expect(outcome).toEqual({ _tag: 'Running', health: { version: '1.2.0', working: 0, updating: false } });
    expect(started).toEqual([]);
    expect(world.launchctl).toEqual([]);
  });

  it('waits for the dev servers when the app is not packaged', async () => {
    const world = createWorld({ packaged: false });
    expect((await ensure(world)).outcome).toEqual({ _tag: 'Waiting', screen: { kind: 'dev' } });
    expect(world.loginItems).toEqual([]);
  });

  it('registers the bundle’s job, shows that it starts, and opens the engine once it answers', async () => {
    const world = createWorld({ answer: answerAfter(2), print: () => ({ ok: true, output: '' }) });
    world.files.set(AGENT, serializeEngineAgent({ path: PROGRAM }));
    const { outcome, started } = await ensure(world);
    expect(outcome._tag).toBe('Running');
    expect(started).toEqual(['starting']);
    expect(world.loginItems).toEqual(['register']);
    expect(listCommands(world)).toEqual([`bootout ${TARGET}`]);
    expect(world.files.has(AGENT)).toBe(false);
  });

  it('keeps a job that is enabled and loaded', async () => {
    const world = createWorld({
      answer: answerAfter(1),
      registration: 'enabled',
      print: () => ({ ok: true, output: '' }),
    });
    expect((await ensure(world)).outcome._tag).toBe('Running');
    expect(world.loginItems).toEqual([]);
  });

  it('registers again a job macOS calls enabled while launchd has none', async () => {
    let loaded = false;
    const world = createWorld({
      answer: answerAfter(1),
      registration: 'enabled',
      print: () => ({ ok: loaded, output: '' }),
      onRegister: () => {
        loaded = true;
        return 'enabled';
      },
    });
    expect((await ensure(world)).outcome._tag).toBe('Running');
    expect(world.loginItems).toEqual(['unregister', 'register']);
  });

  it('asks you to allow the job in Login Items, before and after registering', async () => {
    const waiting = createWorld({ registration: 'requires-approval' });
    expect((await ensure(waiting)).outcome).toEqual({ _tag: 'Waiting', screen: { kind: 'approval' } });
    expect(waiting.loginItems).toEqual([]);
    const asked = createWorld({ onRegister: () => 'requires-approval' });
    expect((await ensure(asked)).outcome).toEqual({ _tag: 'Waiting', screen: { kind: 'approval' } });
  });

  it('writes the job to LaunchAgents where registration is refused', async () => {
    const world = createWorld({
      answer: answerAfter(1),
      env: { SHINSA_HOME: '/tmp/s' },
      onRegister: () => 'unsupported',
    });
    expect((await ensure(world)).outcome._tag).toBe('Running');
    expect(world.files.get(AGENT)).toBe(
      serializeEngineAgent({ path: PROGRAM }, { SHINSA_HOME: '/tmp/s', SHINSA_SERVICE: '1' })
    );
    expect(listCommands(world)).toEqual([`bootstrap gui/501 ${AGENT}`]);
  });

  it('writes the job when registering never loads it, and leaves a loaded job that matches', async () => {
    const world = createWorld({ answer: answerAfter(30) });
    world.files.set(AGENT, serializeEngineAgent({ path: PROGRAM }, { SHINSA_SERVICE: '1' }));
    await ensure(world);
    expect(world.loginItems).toEqual(['register', 'unregister']);
    expect(listCommands(world)).toContain(`bootstrap gui/501 ${AGENT}`);
    const loaded = createWorld({ answer: answerAfter(1), print: () => ({ ok: true, output: '' }) });
    loaded.files.set(AGENT, serializeEngineAgent({ path: PROGRAM }, { SHINSA_SERVICE: '1' }));
    loaded.onRegister = () => 'not-found';
    await ensure(loaded);
    expect(listCommands(loaded)).toEqual([]);
  });

  it('replaces a loaded job that runs another program', async () => {
    const world = createWorld({
      answer: answerAfter(1),
      print: () => ({ ok: true, output: '' }),
      onRegister: () => 'unsupported',
    });
    world.files.set(
      AGENT,
      serializeEngineAgent({ path: PROGRAM }, { SHINSA_SERVICE: '1', SHINSA_HOME: '/old' })
    );
    await ensure(world);
    expect(listCommands(world)).toEqual([`bootout ${TARGET}`, `bootstrap gui/501 ${AGENT}`]);
  });

  it('goes on to say why when the job cannot be written', async () => {
    const world = createWorld({ onRegister: () => 'unsupported' });
    world.unwritable.add(AGENT);
    const { outcome } = await ensure(world);
    expect(outcome).toMatchObject({ _tag: 'Waiting', screen: { kind: 'stopped' } });
    expect(listCommands(world)).not.toContain(`bootstrap gui/501 ${AGENT}`);
  });

  it('takes over a standalone engine’s LaunchAgent, and leaves the app’s own', async () => {
    const world = createWorld({ answer: () => HEALTHY });
    world.files.set(AGENT, serializeEngineAgent({ path: '/opt/homebrew/bin/shinsa' }));
    await ensure(world);
    expect(listCommands(world)).toEqual([`bootout ${TARGET}`]);
    expect(world.files.has(AGENT)).toBe(false);
    const own = createWorld({ answer: () => HEALTHY });
    own.files.set(AGENT, serializeEngineAgent({ path: PROGRAM }));
    await ensure(own);
    expect(own.files.has(AGENT)).toBe(true);
  });

  it('retires the old service once', async () => {
    const world = createWorld({ answer: answerAfter(1), print: () => ({ ok: true, output: '' }) });
    world.files.set(OLD_SERVICE, '<plist/>');
    await runDesktop(
      world,
      EngineSupervisor.use((engine) =>
        Effect.gen(function* () {
          yield* engine.ensure(Effect.void);
          world.files.set(OLD_SERVICE, '<plist/>');
          world.answer = answerAfter(1);
          yield* engine.ensure(Effect.void);
        })
      )
    );
    expect(listCommands(world)).toEqual(['bootout gui/501/studio.overclock.shinsa']);
    expect(world.files.has(OLD_SERVICE)).toBe(true);
  });

  it('restarts its own engine left on the port of the version before', async () => {
    const world = createWorld({
      answer: answerAfter(1),
      print: () => ({ ok: true, output: 'pid = 812\n' }),
    });
    world.files.set(`${DATA}/serve.lock`, '{"pid":812,"port":7300}');
    await ensure(world);
    expect(listCommands(world)).toEqual([`kickstart -k ${TARGET}`]);
  });

  it('kicks a job that has not started after three seconds, and says it stopped after 25', async () => {
    const world = createWorld({ print: () => ({ ok: true, output: 'runs = 1\nlast exit code = 1\n' }) });
    world.files.set(`${DATA}/engine.log`, 'started\n');
    const { outcome } = await ensure(world);
    expect(outcome).toEqual({
      _tag: 'Waiting',
      screen: { kind: 'stopped', detail: `Engine log: ${DATA}/engine.log\n\nstarted` },
    });
    expect(listCommands(world)).toEqual([`kickstart ${TARGET}`]);
  });

  it('names a taken port or a crash loop', async () => {
    const taken = createWorld({ print: () => ({ ok: true, output: '' }) });
    taken.files.set(`${DATA}/engine.log`, 'Is port 7446 in use?\n');
    expect((await ensure(taken)).outcome).toMatchObject({ screen: { kind: 'port', port: 7446 } });
    const crashing = createWorld({ print: () => ({ ok: true, output: 'runs = 4\nlast exit code = 1\n' }) });
    expect((await ensure(crashing)).outcome).toEqual({
      _tag: 'Waiting',
      screen: { kind: 'crashing', detail: `Engine log: ${DATA}/engine.log` },
    });
  });

  it('registers again a job launchd refuses to start, and writes it when that fails too', async () => {
    const refused = { ok: true, output: 'job state = spawn failed\n' };
    const world = createWorld({ print: () => refused, onRegister: () => 'enabled' });
    let registered = 0;
    world.onRegister = () => {
      registered += 1;
      if (registered === 2) world.answer = answerAfter(0);
      return registered === 2 ? 'not-found' : 'enabled';
    };
    world.files.set(AGENT, '<plist/>');
    const { outcome } = await ensure(world);
    expect(outcome._tag).toBe('Running');
    expect(world.loginItems).toEqual(['register', 'unregister', 'register', 'unregister']);
    expect(listCommands(world)).toContain(`bootstrap gui/501 ${AGENT}`);
  });

  it('registers again with the app service when launchd loads it', async () => {
    let refused = true;
    const world = createWorld({
      print: () => ({ ok: true, output: refused ? 'last exit code = 78\n' : '' }),
    });
    let registered = 0;
    world.onRegister = () => {
      registered += 1;
      if (registered === 2) {
        refused = false;
        world.answer = answerAfter(0);
      }
      return 'enabled';
    };
    const { outcome } = await ensure(world);
    expect(outcome._tag).toBe('Running');
    expect(listCommands(world)).not.toContain(`bootstrap gui/501 ${AGENT}`);
  });

  it('restarts the job and reads the engine log for a bug report', async () => {
    const world = createWorld();
    world.files.set(`${DATA}/engine.log`, '{"level":"error","message":"Boom","error":"x"}\n');
    const details = await runDesktop(
      world,
      EngineSupervisor.use((engine) => Effect.andThen(engine.restart, engine.readDetails))
    );
    expect(listCommands(world)).toEqual([`kickstart -k ${TARGET}`]);
    expect(details).toBe(`Engine log: ${DATA}/engine.log\n\nBoom: x`);
  });
});
