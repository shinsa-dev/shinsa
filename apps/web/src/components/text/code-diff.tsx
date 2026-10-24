import * as React from 'react';
import { type DiffLines, type DiffSource, hasDiffBody, resolveDiffNote } from '@/lib/code/diff-view.ts';

const CodeDiffView = React.lazy(() => import('@/components/text/code-diff-view.tsx'));

const NOTE = 'px-3 py-2 text-2xs text-fg-2';

export interface CodeDiffProps {
  source: DiffSource;
  numbered?: boolean;
  selected?: DiffLines | null;
}

export function CodeDiff(props: CodeDiffProps) {
  const note = resolveDiffNote(props.source);
  return (
    <div className='flex min-w-0 flex-col'>
      {note && <p className={NOTE}>{note}</p>}
      {hasDiffBody(props.source) && (
        <React.Suspense fallback={<p className={NOTE}>Loading the changes…</p>}>
          <CodeDiffView {...props} />
        </React.Suspense>
      )}
    </div>
  );
}
