import * as React from 'react';
import { requestEvidenceText, selectEvidenceText } from '@/lib/evidence/texts.ts';

export function useEvidenceText(uri: string) {
  const [text, setText] = React.useState<{ uri: string; body: string } | null>(null);
  React.useEffect(() => {
    if (selectEvidenceText(uri) !== null) return;
    let alive = true;
    void requestEvidenceText(uri).then((body) => {
      if (alive) setText({ uri, body });
    });
    return () => {
      alive = false;
    };
  }, [uri]);
  return selectEvidenceText(uri) ?? (text?.uri === uri ? text.body : null);
}
