import { Context, Effect, Layer, Ref } from 'effect';
import { Prefs } from '../prefs/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { LOCAL_SOURCE, type SourceSetting, type SourceSwitch } from './schema.ts';
import { resolveSourceSwitch } from './source.ts';

export class EngineSource extends Context.Service<
  EngineSource,
  {
    readonly started: SourceSetting;
    readonly current: Effect.Effect<SourceSetting>;
    use(next: SourceSetting): Effect.Effect<SourceSwitch>;
  }
>()('shinsa/desktop/source/EngineSource') {
  static readonly layer = Layer.effect(
    EngineSource,
    Effect.gen(function* () {
      const prefs = yield* Prefs;
      const shell = yield* DesktopShell;
      const started = (yield* prefs.read).engineSource ?? LOCAL_SOURCE;
      const current = yield* Ref.make(started);
      const use = Effect.fn('EngineSource.use')(function* (next: SourceSetting) {
        const step = resolveSourceSwitch(yield* Ref.get(current), next);
        if (step === 'none') return step;
        yield* Ref.set(current, next);
        yield* prefs.write({ engineSource: next });
        if (step === 'relaunch') yield* shell.relaunch;
        return step;
      });
      return EngineSource.of({ started, current: Ref.get(current), use });
    })
  );
}
