import { resolveAgentFastMode, resolveAgentModel, resolveQuickProvider } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import type { JsonSchema } from '../providers/index.ts';
import { Providers } from '../providers/registry/service.ts';
import { parseObject } from './json.ts';
import { requestQuick } from './request.ts';
import { type QuickJson, QuickFastMode, type QuickRole } from './schema.ts';

export class QuickCalls extends Context.Service<
  QuickCalls,
  {
    readonly classify: QuickJson;
    readonly write: QuickJson;
  }
>()('shinsa/engine/agents/quick/QuickCalls') {
  static readonly layer = Layer.effect(
    QuickCalls,
    Effect.gen(function* () {
      const providers = yield* Providers;
      const engine = yield* EngineCore;
      const readFastMode = yield* QuickFastMode;

      const listQuickProviders = (preferred: string) => {
        const listed = providers.list();
        return [
          ...listed.filter((provider) => provider.id === preferred),
          ...listed.filter((provider) => provider.id !== preferred),
        ];
      };

      const createQuickJson =
        (role: QuickRole): QuickJson =>
        <T>(system: string, prompt: string, schema?: JsonSchema) =>
          Effect.flatMap(engine.state, ({ settings }) =>
            requestQuick<T>(
              {
                task: 'a quick answer',
                system,
                prompt,
                schema: schema ?? null,
                parse: parseObject,
                model: (provider) => resolveAgentModel(settings, role, provider),
                fastMode: resolveAgentFastMode(settings, role),
                ...(readFastMode ? { readFastMode } : {}),
              },
              listQuickProviders(resolveQuickProvider(settings, role))
            ).pipe(Effect.map((result) => result.value))
          );

      return QuickCalls.of({ classify: createQuickJson('classifier'), write: createQuickJson('writer') });
    })
  );
}
