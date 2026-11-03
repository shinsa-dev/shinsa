import { Effect } from 'effect';
import type { ToolSpec } from '../agents/tools/schema.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { listLoaderSpecs } from './loader/names.ts';
import {
  ExtensionLoadFailed,
  type ExtensionLoaderHandle,
  type HotLoadSession,
  type LoadableExtensions,
  type OpenClient,
} from './loader/schema.ts';
import { makeExtensionLoader } from './loader/service.ts';

export { describeServerChoice, resolveSkillBody } from './loader/names.ts';
export type { DeferredServer, DeferredSkill, LoadableExtensions, OpenClient } from './loader/schema.ts';

export class ExtensionLoader {
  readonly #extensions: LoadableExtensions;
  readonly #handle: ExtensionLoaderHandle;

  constructor(extensions: LoadableExtensions, open?: OpenClient) {
    this.#extensions = extensions;
    this.#handle = edgeRuntime.runSync(
      makeExtensionLoader({
        extensions,
        open: open
          ? (definition) =>
              Effect.tryPromise({
                try: () => open(definition),
                catch: (error) => new ExtensionLoadFailed({ message: describeError(error) }),
              }).pipe(
                Effect.map((opened) => ({ client: opened.client, close: Effect.promise(opened.close) }))
              )
          : null,
      })
    );
  }

  listSpecs(): ToolSpec[] {
    return listLoaderSpecs(this.#extensions);
  }

  isLoaderTool(name: string) {
    return this.listSpecs().some((spec) => spec.name === name);
  }

  attach(session: HotLoadSession) {
    edgeRuntime.runSync(this.#handle.attach(session));
  }

  handle(name: string, input: Record<string, unknown>) {
    return edgeRuntime.runPromise(this.#handle.handle(name, input));
  }

  close() {
    return edgeRuntime.runPromise(this.#handle.close);
  }
}
