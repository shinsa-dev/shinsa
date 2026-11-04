import { Context, Effect, Layer, Scope } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ConfigStore } from '../../src/config/store/service.ts';
import { ProjectChanges } from '../../src/projects/changes/service.ts';
import { CurrentLogin } from '../../src/repos/current-login/service.ts';
import { RepoRegistry } from '../../src/repos/registry/service.ts';
import { Roots } from '../../src/repos/roots/service.ts';
import type { Discoverer, LoginResolver } from '../../src/repos/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { SecretStore } from '../../src/secrets/store/service.ts';
import { createMachineLayer } from '../../src/serve/layers.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import { Workspaces } from '../../src/workspaces/service.ts';
import type { Engine } from './engine.ts';

const NOTHING_FOUND: Discoverer = () => Promise.resolve({ candidates: [], truncated: false, refused: [] });

export interface TestMachineOptions {
  discover?: Discoverer | null;
  resolveLogin?: LoginResolver;
}

export function createTestMachine(engine: Engine, config: ServerConfig, options: TestMachineOptions = {}) {
  const layer = createMachineLayer({
    ...(options.discover === null ? {} : { discover: options.discover ?? NOTHING_FOUND }),
    resolveLogin: 'resolveLogin' in options ? options.resolveLogin : () => Promise.resolve(null),
  }).pipe(
    Layer.provide(Layer.merge(Layer.succeed(EngineConfig, config), Layer.succeed(EngineCore, engine.core)))
  );
  const context = Effect.runSync(Layer.buildWithScope(layer, Effect.runSync(Scope.make())));
  return {
    context,
    store: Context.get(context, ConfigStore),
    roots: Context.get(context, Roots),
    projects: Context.get(context, ProjectChanges),
    login: Context.get(context, CurrentLogin).lookup,
    registry: Context.get(context, RepoRegistry),
    secrets: Context.get(context, SecretStore),
    evidence: Context.get(context, Evidence),
    workspaces: Context.get(context, Workspaces),
  };
}
