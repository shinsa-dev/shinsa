import { Effect, ManagedRuntime, Option } from 'effect';
import type { AttachmentUpload } from './schema.ts';
import { Attachments } from './service.ts';
import { parseAttachmentUpload } from './upload.ts';

export {
  ATTACHMENT_LIMIT_BYTES,
  ATTACHMENT_REQUEST_LIMIT_BYTES,
  ATTACHMENT_ROUTE,
  type AttachmentUpload,
} from './schema.ts';

export function readAttachmentUpload(body: Record<string, unknown>) {
  return Effect.runSync(parseAttachmentUpload(body));
}

export class AttachmentStore {
  readonly #runtime: ManagedRuntime.ManagedRuntime<Attachments, never>;

  constructor(dir: string) {
    this.#runtime = ManagedRuntime.make(Attachments.layer(dir));
  }

  write(upload: AttachmentUpload) {
    return this.#runtime.runSync(Attachments.use((attachments) => attachments.write(upload)));
  }

  selectFile(name: string) {
    return Option.getOrNull(
      this.#runtime.runSync(Attachments.use((attachments) => attachments.selectFile(name)))
    );
  }
}
