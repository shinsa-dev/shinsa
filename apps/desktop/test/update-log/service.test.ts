import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { UPDATE_LOG } from '../../src/update-log/schema.ts';
import { UpdateLog } from '../../src/update-log/service.ts';
import { createWorld, LOGS, runDesktop } from '../support/desktop.ts';

const FILE = `${LOGS}/updater.log`;

const OLD = `${LOGS}/updater.old.log`;

describe('the updater log', () => {
  it('appends a timestamped line for each message', async () => {
    const world = createWorld();
    await runDesktop(
      world,
      UpdateLog.use((log) =>
        Effect.andThen(log.write('info', 'Checking for update'), log.write('warn', 'offline'))
      )
    );
    expect(world.files.get(FILE)).toBe(
      '1970-01-01T00:00:00.000Z info Checking for update\n1970-01-01T00:00:00.000Z warn offline\n'
    );
  });

  it('starts afresh past a megabyte, keeping the old log beside it', async () => {
    const world = createWorld();
    const big = 'x'.repeat(UPDATE_LOG.limit + 1);
    world.files.set(FILE, big);
    await runDesktop(
      world,
      UpdateLog.use((log) => log.rotate)
    );
    expect(world.files.get(OLD)).toBe(big);
    expect(world.files.has(FILE)).toBe(false);
  });

  it('keeps a small log, and does nothing without one', async () => {
    const world = createWorld();
    world.files.set(FILE, 'small');
    await runDesktop(
      world,
      UpdateLog.use((log) => log.rotate)
    );
    expect(world.files.get(FILE)).toBe('small');
    const empty = createWorld();
    await runDesktop(
      empty,
      UpdateLog.use((log) => log.rotate)
    );
    expect(empty.files.size).toBe(0);
  });

  it('never fails the updater when the log cannot be written', async () => {
    const world = createWorld({ unwritable: new Set([FILE]) });
    world.files.set(FILE, 'x'.repeat(UPDATE_LOG.limit + 1));
    await runDesktop(
      world,
      UpdateLog.use((log) => Effect.andThen(log.rotate, log.write('error', 'lost')))
    );
    expect(world.files.has(OLD)).toBe(false);
  });
});
