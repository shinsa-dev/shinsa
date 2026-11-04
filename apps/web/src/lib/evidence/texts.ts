import { Effect } from 'effect';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestEvidenceBody } from '@/lib/connection/evidence.ts';
import { createCache } from '@/lib/format/cache.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { StepFailed } from '@/lib/runtime/schema.ts';

export const EVIDENCE_TEXT_LIMIT = 32;

const texts = createCache<string>(EVIDENCE_TEXT_LIMIT);

const pending = new Map<string, Promise<string>>();

export function selectEvidenceText(uri: string) {
  return texts.peek(uri) ?? null;
}

export function recordEvidenceText(uri: string, body: string) {
  texts.read(uri, () => body);
}

export function resetEvidenceTexts() {
  texts.clear();
  pending.clear();
}

export function requestEvidenceText(uri: string) {
  const known = selectEvidenceText(uri);
  if (known !== null) return Promise.resolve(known);
  const running = pending.get(uri);
  if (running) return running;
  const request = runApp(
    Effect.tryPromise({
      try: () => requestEvidenceBody(uri),
      catch: (error) => new StepFailed({ message: describeFailure(error) }),
    }).pipe(
      Effect.tap((body) => Effect.sync(() => recordEvidenceText(uri, body))),
      Effect.catchTag('StepFailed', (failed) =>
        Effect.succeed(`Couldn’t read this evidence. ${failed.message}`)
      ),
      Effect.ensuring(Effect.sync(() => pending.delete(uri)))
    )
  );
  pending.set(uri, request);
  return request;
}
