import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestText } from '@/lib/connection/http.ts';

export function useEvidenceText(uri: string) {
  const [text, setText] = React.useState<{ uri: string; body: string } | null>(null);
  React.useEffect(() => {
    let alive = true;
    requestText(uri).then(
      (body) => {
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
  return text?.uri === uri ? text.body : null;
}
