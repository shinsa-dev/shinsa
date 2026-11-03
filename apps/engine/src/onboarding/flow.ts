import type { JsonObject } from '../http/schema.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { OnboardingSetupHandle } from './flow/schema.ts';

export class OnboardingSetup {
  readonly #handle: OnboardingSetupHandle;

  constructor(handle: OnboardingSetupHandle) {
    this.#handle = handle;
  }

  resolve() {
    return edgeRuntime.runPromise(this.#handle.resolve);
  }

  selectHelp() {
    return edgeRuntime.runPromise(this.#handle.selectHelp);
  }

  reply(fields: JsonObject) {
    return edgeRuntime.runPromise(this.#handle.reply(fields));
  }
}
