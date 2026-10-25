import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestText } from '@/lib/connection/http.ts';
import { createCache } from '@/lib/format/cache.ts';

export const EVIDENCE_TEXT_LIMIT = 32;

const texts = createCache<string>(EVIDENCE_TEXT_LIMIT);

export function useEvidenceText(uri: string) {
  const [text, setText] = React.useState<{ uri: string; body: string } | null>(null);
  React.useEffect(() => {
    if (texts.peek(uri) !== undefined) return;
    let alive = true;
    requestText(uri).then(
      (body) => {
        texts.read(uri, () => body);
        if (alive) setText({ uri, body });
      },
      (error: unknown) => {
        if (alive) setText({ uri, body: `Couldn’t read this evidence. ${describeFailure(error)}` });
      }
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  return texts.peek(uri) ?? (text?.uri === uri ? text.body : null);
}
