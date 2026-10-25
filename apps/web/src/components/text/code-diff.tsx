import * as React from 'react';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { type DiffLines, type DiffSource, hasDiffBody, resolveDiffNote } from '@/lib/code/diff-view.ts';

type DiffViewModule = typeof import('@/components/text/code-diff-view.tsx');

let loadedView: DiffViewModule | null = null;

export async function requestCodeDiffView() {
  loadedView = await import('@/components/text/code-diff-view.tsx');
  return loadedView;
}

const NOTE = 'px-3 py-2 text-2xs text-fg-2';

export interface CodeDiffProps {
  source: DiffSource;
  numbered?: boolean;
  selected?: DiffLines | null;
}

function CodeDiffBody(props: CodeDiffProps) {
  const [module, setModule] = React.useState<DiffViewModule | 'failed' | null>(loadedView);
  React.useEffect(() => {
    if (module) return;
    requestCodeDiffView().then(setModule, () => setModule('failed'));
  }, [module]);
  if (module === 'failed')
    return <p className={NOTE}>The changes did not load. Reload the page to try again.</p>;
  if (!module) return <LoadingLine label='Reading the changes' className={NOTE} />;
  return <module.default {...props} />;
}

export function CodeDiff(props: CodeDiffProps) {
  const note = resolveDiffNote(props.source);
  return (
    <div className='flex min-w-0 flex-col'>
      {note && <p className={NOTE}>{note}</p>}
      {hasDiffBody(props.source) && <CodeDiffBody {...props} />}
    </div>
  );
}
