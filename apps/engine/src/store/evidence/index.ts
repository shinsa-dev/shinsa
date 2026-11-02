import { Effect, ManagedRuntime, Option } from 'effect';
import { resolveFolderPath } from './folder.ts';
import type { EvidenceFolder, TextExtension } from './schema.ts';
import { Evidence } from './service.ts';

export { EVIDENCE_COPY_LIMIT_BYTES, EVIDENCE_ROUTE, type EvidenceFolder } from './schema.ts';

export function resolveEvidenceFolder(folder: EvidenceFolder) {
  return Effect.runSync(resolveFolderPath(folder));
}

export class EvidenceStore {
  readonly #runtime: ManagedRuntime.ManagedRuntime<Evidence, never>;

  constructor(dir: string) {
    this.#runtime = ManagedRuntime.make(Evidence.layer(dir));
  }

  writeImage(base64: string, mediaType: string) {
    return this.#runtime.runSync(Evidence.use((evidence) => evidence.writeImage(base64, mediaType)));
  }

  writeText(text: string, folder: EvidenceFolder, title: string, extension: TextExtension = 'txt') {
    return this.#runtime.runSync(
      Evidence.use((evidence) => evidence.writeText(text, folder, title, extension))
    );
  }

  copyFile(source: string, folder: EvidenceFolder, title: string) {
    return this.#runtime.runSync(Evidence.use((evidence) => evidence.copyFile(source, folder, title)));
  }

  selectFile(name: string) {
    return Option.getOrNull(this.#runtime.runSync(Evidence.use((evidence) => evidence.selectFile(name))));
  }
}
