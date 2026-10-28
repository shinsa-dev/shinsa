import { describeFailure } from '@/lib/connection/commands.ts';
import { requestText } from '@/lib/connection/http.ts';
import { createCache } from '@/lib/format/cache.ts';

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
  const request = requestText(uri).then(
    (body) => {
      recordEvidenceText(uri, body);
      return body;
    },
    (error: unknown) => `Couldn’t read this evidence. ${describeFailure(error)}`
  );
  const settled = request.finally(() => pending.delete(uri));
  pending.set(uri, settled);
  return settled;
}
