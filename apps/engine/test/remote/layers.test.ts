import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import { Handoffs } from '../../src/remote/handoffs/service.ts';
import { RemoteEdgeLayer, RemoteLayer, RemoteQuickLayer } from '../../src/remote/layers.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import { RemoteUrlOpener } from '../../src/remote/opener/service.ts';
import { PlacementAsker } from '../../src/remote/placement/service.ts';
import { createRefusedConnector } from '../../src/remote/relay/refused.ts';
import { ShareDescriber } from '../../src/remote/share-describe/service.ts';
import { Shares } from '../../src/remote/shares/service.ts';
import { RemoteStore } from '../../src/remote/store/service.ts';
import { TeamFeeds } from '../../src/remote/team-feeds/service.ts';
import { Teams } from '../../src/remote/teams/service.ts';
import { createTempDir } from '../helpers/index.ts';
import { createRemoteFoundation } from './harness.ts';

describe('the remote layers', () => {
  test('build the machine, its teams, shares, feeds and hand-offs, the edge and the quick calls on one foundation', async () => {
    const dataDir = createTempDir();
    const foundation = createRemoteFoundation(dataDir, { dataDir, userHome: dataDir });
    const edge = Layer.merge(RemoteEdgeLayer, createRefusedConnector('no tunnel in this test'));
    const remote = RemoteLayer({
      version: '1',
      machineName: 'Studio',
      maxBodyBytes: 1024,
      localUrl: Effect.succeed('http://127.0.0.1:1'),
    }).pipe(Layer.provide(edge));
    const quick = RemoteQuickLayer.pipe(
      Layer.provide(Layer.succeed(QuickCalls, {} as QuickCalls['Service']))
    );
    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const services = [
          yield* Remote,
          yield* RemoteStore,
          yield* Teams,
          yield* Shares,
          yield* TeamFeeds,
          yield* Handoffs,
          yield* RemoteUrlOpener,
          yield* PlacementAsker,
          yield* ShareDescriber,
        ];
        return { services: services.length, paired: (yield* (yield* Remote).snapshot).paired };
      }).pipe(
        Effect.provide(Layer.mergeAll(remote, edge, quick).pipe(Layer.provide(foundation))),
        Effect.scoped
      )
    );
    expect(built).toEqual({ services: 9, paired: false });
  });
});
