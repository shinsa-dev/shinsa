import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { requestEvidenceText, selectEvidenceText } from '@/lib/evidence/texts.ts';

export function useEvidenceText(uri: string) {
  const [text, setText] = React.useState<{ uri: string; body: string } | null>(null);
  useAppEffect(() => {
    if (selectEvidenceText(uri) !== null) return Effect.void;
    return Effect.promise(() => requestEvidenceText(uri)).pipe(
      Effect.tap((body) => Effect.sync(() => setText({ uri, body })))
    );
  }, [uri]);
  return selectEvidenceText(uri) ?? (text?.uri === uri ? text.body : null);
}
