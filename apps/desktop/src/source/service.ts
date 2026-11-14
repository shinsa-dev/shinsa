import { Context, Deferred, Effect, Layer, PubSub, Ref, Stream } from 'effect';
import { Prefs } from '../prefs/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { LOCAL_SOURCE, type SourceSetting, type SourceSwitch } from './schema.ts';
import { resolveSourceSwitch } from './source.ts';

export class EngineSource extends Context.Service<
  EngineSource,
  {
    readonly started: SourceSetting;
    readonly chosen: Effect.Effect<boolean>;
    readonly firstChoice: Effect.Effect<void>;
    readonly current: Effect.Effect<SourceSetting>;
    readonly changes: Stream.Stream<SourceSetting>;
    use(next: SourceSetting): Effect.Effect<SourceSwitch>;
  }
>()('shinsa/desktop/source/EngineSource') {
  static readonly layer = Layer.effect(
    EngineSource,
    Effect.gen(function* () {
      const prefs = yield* Prefs;
      const shell = yield* DesktopShell;
      const saved = (yield* prefs.read).engineSource;
      const started = saved ?? LOCAL_SOURCE;
      const current = yield* Ref.make(started);
      const chosen = yield* Ref.make(saved !== undefined);
      const choice = yield* Deferred.make<void>();
      const changes = yield* PubSub.unbounded<SourceSetting>();
      if (saved !== undefined) yield* Deferred.succeed(choice, undefined);
      const use = Effect.fn('EngineSource.use')(function* (next: SourceSetting) {
        const first = !(yield* Ref.getAndSet(chosen, true));
        const step = resolveSourceSwitch(yield* Ref.get(current), next);
        if (step === 'none' && !first) return step;
        yield* Ref.set(current, next);
        yield* prefs.write({ engineSource: next });
        if (step === 'relaunch') {
          yield* shell.relaunch;
          return step;
        }
        yield* Deferred.succeed(choice, undefined);
        if (step === 'reload') yield* PubSub.publish(changes, next);
        return step;
      });
      return EngineSource.of({
        started,
        chosen: Ref.get(chosen),
        firstChoice: Deferred.await(choice),
        current: Ref.get(current),
        changes: Stream.fromPubSub(changes),
        use,
      });
    })
  );
}
